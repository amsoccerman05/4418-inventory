begin;
-- Tool custody is a claim on physical balances, never a subtraction from owned total.
create table public.tool_loans (
 id uuid primary key default gen_random_uuid(),
 inventory_item_id uuid not null references public.inventory_items(id),
 borrower text not null check(length(trim(borrower)) between 1 and 160),
 project text not null default '' check(length(project)<=200),
 home_location_id uuid not null references public.locations(id),
 location_id uuid not null references public.locations(id),
 quantity numeric not null check(quantity>0 and quantity<='9007199254740991'::numeric and quantity=trunc(quantity)),
 returned_quantity numeric not null default 0 check(returned_quantity>=0 and returned_quantity=trunc(returned_quantity)),
 expected_return date not null,
 status text not null default 'out' check(status in ('out','missing','returned')),
 notes text not null default '',created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(home_location_id<>location_id),check(returned_quantity<=quantity),
 check((status='returned')=(returned_quantity=quantity))
);
create index tool_loans_open_balance_idx on public.tool_loans(inventory_item_id,location_id) where status<>'returned';
create index tool_loans_due_idx on public.tool_loans(expected_return) where status<>'returned';
alter table public.tool_loans enable row level security;
revoke all on public.tool_loans from public,anon,authenticated;
grant select on public.tool_loans to authenticated;
create policy team_read on public.tool_loans for select to authenticated using(private.current_role() is not null);
-- Private durable receipts make a lost response or duplicate submission safe to retry.
create table private.tool_checkout_operations (
 id uuid primary key,actor uuid not null references auth.users(id),action text not null,payload jsonb not null,
 loan_id uuid not null references public.tool_loans(id),created_at timestamptz not null default now()
);
alter table private.tool_checkout_operations enable row level security;
revoke all on private.tool_checkout_operations from public,anon,authenticated;

create function private.tool_loan_reserved(p_item uuid,p_location uuid) returns numeric
language sql stable security definer set search_path='' as $$
 select coalesce(sum(quantity-returned_quantity),0) from public.tool_loans
 where inventory_item_id=p_item and location_id=p_location and status<>'returned'
$$;
-- Phase 4's optional reservation hook becomes custody-aware after this upgrade.
create or replace function private.packing_external_reserved(p_item uuid,p_location uuid) returns numeric
language sql stable security definer set search_path='' as $$select private.tool_loan_reserved(p_item,p_location)$$;
revoke all on function private.packing_external_reserved(uuid,uuid) from public,anon,authenticated;
-- Enforce at the shared accounting boundary, including legacy counts, moves and trip packing.
create function private.guard_tool_loan_balance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.quantity<private.tool_loan_reserved(new.inventory_item_id,new.location_id) then
  raise exception 'Outstanding tool loans reserve this quantity. Return the specific loan first.';
 end if;
 return new;
end $$;
-- AFTER avoids rejecting the harmless audit INSERT 0 ON CONFLICT DO NOTHING.
-- An invariant failure still rolls back the entire statement/transaction.
create trigger guard_tool_loan_balance after insert or update on public.inventory_balances for each row execute function private.guard_tool_loan_balance();
create function private.guard_tool_loan_item() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.item_type is distinct from old.item_type or new.ownership is distinct from old.ownership or new.location_id is distinct from old.location_id)
 and exists(select 1 from public.tool_loans where inventory_item_id=old.id and status<>'returned') then
  raise exception 'Return outstanding tool loans before changing type, ownership or home.';
 end if;
 return new;
end $$;
create trigger guard_tool_loan_item before update on public.inventory_items for each row execute function private.guard_tool_loan_item();
-- An empty checkout origin must remain usable until its outstanding tools return.
create function private.guard_tool_loan_location() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (not new.active or new.trip_id is not null or new.classification='travel')
 and exists(select 1 from public.tool_loans where status<>'returned' and (home_location_id=old.id or location_id=old.id)) then
  raise exception 'Return outstanding tool loans before archiving or converting this location to travel.';
 end if;
 return new;
end $$;
create trigger guard_tool_loan_location before update on public.locations for each row execute function private.guard_tool_loan_location();
-- Prevent approvals from treating checked-out quantity as physically available.
create function private.guard_tool_loan_manifest() returns trigger language plpgsql security definer set search_path='' as $$
declare have numeric;reserved numeric;approved numeric;
begin
 if new.status='approved' then
  if tg_op='UPDATE' and old.status='approved' and new.inventory_item_id=old.inventory_item_id and new.home_location_id=old.home_location_id and new.trip_id=old.trip_id and new.quantity<=old.quantity then return new;end if;
  perform 1 from public.inventory_items where id=new.inventory_item_id for update;
  reserved:=private.tool_loan_reserved(new.inventory_item_id,new.home_location_id);
  if reserved>0 then
   select coalesce(sum(quantity),0) into have from public.inventory_balances where inventory_item_id=new.inventory_item_id and location_id=new.home_location_id;
   select coalesce(sum(m.quantity),0) into approved from public.trip_manifest_items m join public.trips t on t.id=m.trip_id where m.inventory_item_id=new.inventory_item_id and m.home_location_id=new.home_location_id and m.status='approved' and t.status not in ('closed','cancelled') and m.id<>new.id;
   if new.quantity>have-reserved-approved then raise exception 'Outstanding tool loans and other approvals reduce the quantity available for packing';end if;
  end if;
 end if;
 return new;
end $$;
create trigger guard_tool_loan_manifest before insert or update on public.trip_manifest_items for each row execute function private.guard_tool_loan_manifest();

-- Preserve the existing movement vocabulary while adding explicit custody events.
alter table public.inventory_movements drop constraint inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check check(movement_type in ('transfer','trip_pack','trip_internal_move','trip_return','adjustment','resolution','tool_checkout','tool_return','tool_missing','tool_found'));

create function private.tool_checkout_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); op uuid; previous private.tool_checkout_operations; loan public.tool_loans; item public.inventory_items;
 iid uuid;src uuid;dst uuid;qty numeric;have numeric;there numeric;approved numeric;borrower_name text;project_name text;due date;note text:=trim(coalesce(p_data->>'note',''));result_id uuid;movement text;stamp timestamptz;
begin
 if actor is null or not private.can_count() then raise exception 'You do not have permission for tool checkout actions' using errcode='42501';end if;
 if p_action not in ('checkout','return','mark_missing','mark_found') then raise exception 'Unknown tool action';end if;
 op:=nullif(p_data->>'operationId','')::uuid;if op is null then raise exception 'An operation ID is required';end if;
 perform pg_advisory_xact_lock(hashtextextended(op::text,441805));
 -- Permission may have changed while this request was queued.
 if not private.can_count() then raise exception 'You do not have permission for tool checkout actions' using errcode='42501';end if;
 select * into previous from private.tool_checkout_operations where id=op;
 if found then
  if previous.actor<>actor or previous.action<>p_action or previous.payload<>p_data then raise exception 'This operation ID was already used for a different request';end if;
  return jsonb_build_object('id',previous.loan_id,'replayed',true);
 end if;
 if p_action='checkout' then iid:=nullif(p_data->>'itemId','')::uuid;
 else select inventory_item_id into iid from public.tool_loans where id=nullif(p_data->>'loanId','')::uuid;end if;
 -- Shared inventory row lock serializes with every balance movement/count and other loans.
 select * into item from public.inventory_items where id=iid for update;
 if not found then raise exception 'Tool or loan not found';end if;
 if not private.can_count() then raise exception 'You do not have permission for tool checkout actions' using errcode='42501';end if;
 if item.item_type<>'Tool' then raise exception 'Only Tool items can be checked out. Consumables use quantity controls.';end if;
 stamp:=clock_timestamp();
 if p_action='checkout' then
  qty:=(p_data->>'quantity')::numeric;borrower_name:=trim(coalesce(p_data->>'borrower',''));project_name:=trim(coalesce(p_data->>'project',''));
  if qty is null or qty<=0 or qty>'9007199254740991'::numeric or qty<>trunc(qty) then raise exception 'Enter a positive whole number of tools';end if;
  if length(borrower_name) not between 1 and 160 or length(project_name)>200 then raise exception 'Enter who has the tool (up to 160 characters)';end if;
  if coalesce(p_data->>'expectedReturn','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid expected return date';end if;
  due:=(p_data->>'expectedReturn')::date;
  src:=nullif(p_data->>'from','')::uuid;dst:=nullif(p_data->>'to','')::uuid;
 else
  select * into loan from public.tool_loans where id=(p_data->>'loanId')::uuid for update;
  if not private.can_count() then raise exception 'You do not have permission for tool checkout actions' using errcode='42501';end if;
  if loan.status='returned' then raise exception 'This loan is already returned';end if;
  if loan.updated_at is distinct from nullif(p_data->>'updatedAt','')::timestamptz then raise exception 'Loan changed. Review the latest outstanding quantity.' using errcode='40001';end if;
  result_id:=loan.id;src:=loan.location_id;dst:=loan.home_location_id;
  if p_action='return' then
   qty:=(p_data->>'quantity')::numeric;
   if qty is null or qty<=0 or qty>loan.quantity-loan.returned_quantity or qty<>trunc(qty) then raise exception 'Return quantity exceeds the outstanding loan';end if;
  else
   if note='' then raise exception 'A note is required when changing missing status';end if;
   if (p_action='mark_missing' and loan.status<>'out') or (p_action='mark_found' and loan.status<>'missing') then raise exception 'Loan status changed. Refresh first.';end if;
   update public.tool_loans set status=case when p_action='mark_missing' then 'missing' else 'out' end,updated_at=stamp,notes=concat_ws(E'\n',nullif(notes,''),note) where id=loan.id;
   insert into public.inventory_movements(inventory_item_id,item_name,quantity,from_location_id,to_location_id,movement_type,user_id,note)
    values(item.id,item.name,0,src,src,case when p_action='mark_missing' then 'tool_missing' else 'tool_found' end,actor,note);
   insert into private.tool_checkout_operations(id,actor,action,payload,loan_id) values(op,actor,p_action,p_data,result_id);
   return jsonb_build_object('id',result_id);
  end if;
 end if;
 if src is null or dst is null or src=dst then raise exception 'Choose different active non-travel locations';end if;
 perform 1 from public.locations where id in (src,dst) order by id for share;
 if (select count(*) from public.locations where id in (src,dst) and active and trip_id is null and classification<>'travel')<>2 then raise exception 'Choose different active non-travel locations';end if;
 perform pg_advisory_xact_lock(hashtextextended(least(src::text,dst::text),4418));
 perform pg_advisory_xact_lock(hashtextextended(greatest(src::text,dst::text),4418));
 if not private.can_count() then raise exception 'You do not have permission for tool checkout actions' using errcode='42501';end if;
 select coalesce(sum(quantity),0) into have from public.inventory_balances where inventory_item_id=item.id and location_id=src;
 select coalesce(sum(quantity),0) into there from public.inventory_balances where inventory_item_id=item.id and location_id=dst;
 if p_action='checkout' then
  select coalesce(sum(m.quantity),0) into approved from public.trip_manifest_items m join public.trips t on t.id=m.trip_id where m.inventory_item_id=item.id and m.home_location_id=src and m.status='approved' and t.status not in ('closed','cancelled');
  if qty>have-private.tool_loan_reserved(item.id,src)-approved then raise exception 'Not enough available tools at the source after outstanding loans and trip approvals';end if;
 else
  if qty>have then raise exception 'Not enough quantity at the source';end if;
  update public.tool_loans set returned_quantity=returned_quantity+qty,status=case when returned_quantity+qty=quantity then 'returned' else status end,
   updated_at=stamp,notes=case when note<>'' then concat_ws(E'\n',nullif(notes,''),note) else notes end where id=loan.id;
 end if;
 perform private.balance_set(item.id,src,have-qty);perform private.balance_set(item.id,dst,there+qty);
 if p_action='checkout' then
  insert into public.tool_loans(inventory_item_id,borrower,project,home_location_id,location_id,quantity,expected_return,notes,created_by,created_at,updated_at)
   values(item.id,borrower_name,project_name,src,dst,qty,due,note,actor,stamp,stamp) returning id into result_id;
 end if;
 movement:=case when p_action='checkout' then 'tool_checkout' else 'tool_return' end;
 insert into public.inventory_movements(inventory_item_id,item_name,quantity,from_location_id,to_location_id,movement_type,user_id,note)
  values(item.id,item.name,qty,src,dst,movement,actor,note);
 perform private.balance_sync(item.id);
 insert into private.tool_checkout_operations(id,actor,action,payload,loan_id) values(op,actor,p_action,p_data,result_id);
 return jsonb_build_object('id',result_id);
end $$;
create function public.tool_checkout_action(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.tool_checkout_action(p_action,p_data)$$;
create function public.tool_checkout_features() returns boolean language sql stable security invoker set search_path='' as $$select private.current_role() is not null$$;
revoke all on function private.tool_loan_reserved(uuid,uuid),private.guard_tool_loan_balance(),private.guard_tool_loan_item(),private.guard_tool_loan_location(),private.guard_tool_loan_manifest(),private.tool_checkout_action(text,jsonb) from public,anon,authenticated;
grant execute on function private.tool_checkout_action(text,jsonb) to authenticated;
revoke all on function public.tool_checkout_action(text,jsonb),public.tool_checkout_features() from public,anon;
grant execute on function public.tool_checkout_action(text,jsonb),public.tool_checkout_features() to authenticated;
do $$begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.tool_loans;end if;end $$;
commit;
