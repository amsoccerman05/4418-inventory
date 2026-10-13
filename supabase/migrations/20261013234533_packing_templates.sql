begin;
-- Immutable planned kits: never store packed/return status, ownership snapshots, or movements.
create table public.packing_templates (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 100),
 lines jsonb not null check(jsonb_typeof(lines)='array' and jsonb_array_length(lines) between 1 and 200),
 source_trip_id uuid references public.trips(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index manifest_pending_packing_idx on public.trip_manifest_items(inventory_item_id,home_location_id) where status='approved';
create index packing_templates_source_trip_idx on public.packing_templates(source_trip_id);
create index packing_templates_creator_idx on public.packing_templates(created_by);
alter table public.packing_templates enable row level security;
revoke all on public.packing_templates from public,anon,authenticated;
grant select on public.packing_templates to authenticated;
create policy packing_templates_read on public.packing_templates for select to authenticated
 using((select private.current_role()) is not null);

-- Durable idempotency receipts are private, actor-bound and never directly client-writable.
create table private.packing_template_requests (
 actor_id uuid not null references auth.users(id),request_id uuid not null,
 action text not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
revoke all on private.packing_template_requests from public,anon,authenticated;

-- Phase 5 overrides this hook with outstanding tool-loan reservations. The phase-4
-- baseline has no external reservations, and must not grant public helper access.
create function private.packing_external_reserved(p_item uuid,p_location uuid) returns numeric
 language sql stable security invoker set search_path='' as $$select 0::numeric$$;
revoke all on function private.packing_external_reserved(uuid,uuid) from public,anon,authenticated;

create function private.packing_template_action(p_action text,p_data jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();v_request_id uuid;old_request private.packing_template_requests;
 source_trip public.trips;target_trip public.trips;source_lines jsonb;line jsonb;source_id uuid;template_id uuid;
 item public.inventory_items;balance public.inventory_balances;home public.locations;destination public.locations;
 requested numeric;available numeric;name text;new_id uuid;result jsonb;approved jsonb:='[]'::jsonb;
begin
 if actor is null or not coalesce(private.current_role() in ('lead','admin','mentor'),false) then
  raise exception 'A lead, admin or mentor must manage packing templates' using errcode='42501';
 end if;
 if p_action not in ('save','approve') then raise exception 'Unknown packing template action';end if;
 v_request_id:=nullif(p_data->>'requestId','')::uuid;
 if v_request_id is null then raise exception 'A request ID is required';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||v_request_id::text,441804));
 -- Authorization may change while a duplicate operation is queued.
 if not coalesce(private.current_role() in ('lead','admin','mentor'),false) then raise exception 'Your packing template permission changed while waiting. Refresh and try again' using errcode='42501';end if;
 select * into old_request from private.packing_template_requests r where r.actor_id=actor and r.request_id=v_request_id;
 if found then
  if old_request.action<>p_action or old_request.payload<>p_data then raise exception 'Request ID was already used for different input';end if;
  return old_request.result;
 end if;
 source_id:=nullif(p_data->>'sourceTripId','')::uuid;template_id:=nullif(p_data->>'templateId','')::uuid;
 if p_action='save' then
  name:=trim(p_data->>'name');
  if name is null or length(name) not between 1 and 100 then raise exception 'Enter a template name up to 100 characters';end if;
  select * into source_trip from public.trips where id=source_id for share;
  if not found or source_trip.status='cancelled' then raise exception 'Choose a source trip that is not cancelled';end if;
 else
  if (source_id is null)=(template_id is null) then raise exception 'Choose one template or closed trip';end if;
  select * into target_trip from public.trips where id=nullif(p_data->>'tripId','')::uuid for update;
  if not found or target_trip.status not in ('planning','packing') then raise exception 'Approve items during planning or packing';end if;
  if source_id is not null then
   select * into source_trip from public.trips where id=source_id;
   if not found or source_trip.status<>'closed' then raise exception 'Only a closed previous trip can be copied';end if;
  end if;
 end if;
 if source_id is not null then
  -- Partial packs/returns split rows, but the sum remains the original intended quantity.
  -- Destination deliberately omitted: old travel locations are archived and must be reselected.
  select jsonb_agg(jsonb_build_object('itemId',s.inventory_item_id,'quantity',s.quantity,'homeLocationId',s.home_location_id)
   order by s.inventory_item_id,s.home_location_id) into source_lines
   from (select inventory_item_id,home_location_id,sum(quantity) quantity from public.trip_manifest_items
    where trip_id=source_id group by inventory_item_id,home_location_id) s;
 else
  select lines into source_lines from public.packing_templates where id=template_id;
 end if;
 if source_lines is null or jsonb_array_length(source_lines) not between 1 and 200 then raise exception 'Choose a plan with 1–200 item allocations';end if;
 if p_action='save' then
  -- Recheck after the source-trip lock and source snapshot.
  if not coalesce(private.current_role() in ('lead','admin','mentor'),false) then raise exception 'Your packing template permission changed while waiting. Refresh and try again' using errcode='42501';end if;
  insert into public.packing_templates(name,lines,source_trip_id,created_by)
   values(name,source_lines,source_id,actor) returning id into new_id;
  result:=jsonb_build_object('id',new_id);
 else
  if not coalesce((p_data->>'reviewed')::boolean,false) or jsonb_typeof(p_data->'lines') is distinct from 'array' then
   raise exception 'Review quantities, locations and availability first';end if;
  if jsonb_array_length(p_data->'lines') not between 1 and 200 then raise exception 'Review 1–200 item allocations';end if;
  -- Same lock hierarchy as inventory_action: trip, then items. Deterministic item order
  -- serializes availability with all existing inventory movements and avoids cross-kit deadlocks.
  perform i.id from public.inventory_items i where i.id in
   (select (x->>'itemId')::uuid from jsonb_array_elements(p_data->'lines') x) order by i.id for update;
  for line in select value from jsonb_array_elements(p_data->'lines') loop
   if not exists(select 1 from jsonb_array_elements(source_lines) s where s->>'itemId'=line->>'itemId') then
    raise exception 'Item is no longer in the source plan';end if;
   select * into item from public.inventory_items where id=(line->>'itemId')::uuid;
   if not found then raise exception 'Item is no longer available';end if;
   requested:=(line->>'quantity')::numeric;
   if requested is null or requested<=0 or requested>='Infinity'::numeric then raise exception 'Enter a finite quantity greater than zero';end if;
   select * into home from public.locations where id=(line->>'homeLocationId')::uuid and active and trip_id is null for share;
   if not found then raise exception 'Choose an active non-travel home';end if;
   select * into destination from public.locations where id=(line->>'destinationId')::uuid and active and trip_id=target_trip.id for share;
   if not found then raise exception 'Choose an active destination in this trip';end if;
   select * into balance from public.inventory_balances where inventory_item_id=item.id and location_id=home.id;
   if not found or nullif(line->>'itemUpdatedAt','') is null or nullif(line->>'balanceUpdatedAt','') is null
    or item.updated_at is distinct from (line->>'itemUpdatedAt')::timestamptz
    or balance.updated_at is distinct from (line->>'balanceUpdatedAt')::timestamptz then
    raise exception 'Availability changed. Refresh and review again' using errcode='40001';end if;
   select balance.quantity-coalesce(sum(m.quantity),0)-private.packing_external_reserved(item.id,home.id) into available from public.trip_manifest_items m
    join public.trips t on t.id=m.trip_id where m.inventory_item_id=item.id and m.home_location_id=home.id
    and m.status='approved' and t.status not in ('closed','cancelled');
   select sum((x->>'quantity')::numeric) into requested from jsonb_array_elements(p_data->'lines') x
    where x->>'itemId'=line->>'itemId' and x->>'homeLocationId'=line->>'homeLocationId';
   if requested>available then raise exception 'Not enough available stock after existing approvals';end if;
  end loop;
  -- Recheck after all trip, item and location lock waits, before any write.
  if not coalesce(private.current_role() in ('lead','admin','mentor'),false) then raise exception 'Your packing template permission changed while waiting. Refresh and try again' using errcode='42501';end if;
  -- Reuse existing approval permission, trip checks, ownership attribution and history.
  -- Approval never moves balances. Any later failure rolls the entire batch back.
  for line in select value from jsonb_array_elements(p_data->'lines') loop
   result:=public.inventory_action('approve',jsonb_build_object('tripId',target_trip.id,'itemId',line->>'itemId',
    'quantity',line->'quantity','from',line->>'homeLocationId','to',line->>'destinationId','note','Reviewed packing plan'));
   approved:=approved||jsonb_build_array(result->>'id');
  end loop;
  result:=jsonb_build_object('manifestIds',approved);
 end if;
 insert into private.packing_template_requests(actor_id,request_id,action,payload,result) values(actor,v_request_id,p_action,p_data,result);
 return result;
end $$;
revoke all on function private.packing_template_action(text,jsonb) from public,anon,authenticated;
grant execute on function private.packing_template_action(text,jsonb) to authenticated;
create function public.packing_template_action(p_action text,p_data jsonb) returns jsonb
 language sql security invoker set search_path='' as $$select private.packing_template_action(p_action,p_data)$$;
revoke all on function public.packing_template_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.packing_template_action(text,jsonb) to authenticated;
comment on function public.packing_template_action(text,jsonb) is 'Authenticated planned-kit save/approval. Actor-bound idempotency; no physical movement.';
commit;
