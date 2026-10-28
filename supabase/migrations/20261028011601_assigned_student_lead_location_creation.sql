-- MANUAL ROLLOUT ONLY after explicit permission and release approval.
-- Adds location creation for assigned student leaders; no role/assignment/data backfill.
-- Requires the shared Hub team_positions, team_member_positions and membership tables.
begin;

create function private.can_create_assigned_lead_location() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.profiles p
  join auth.users u on u.id=p.id
  join public.team_member_positions mp on mp.user_id=p.id and mp.revoked_at is null
  join public.team_positions pos on pos.key=mp.position_key and pos.active
  where p.id=auth.uid() and p.active and p.role::text in ('student','lead')
   and u.email_confirmed_at is not null and u.last_sign_in_at is not null
   and (u.banned_until is null or u.banned_until<=now())
   and not exists(select 1 from public.team_attendance_members m where m.student_id=p.id and m.member_status='inactive')
   and pos.key in ('business_lead','cad_lead','communications_lead','fabrication_lead','finance_lead',
    'operations_lead','power_lead','software_lead','strategy_lead','program_manager','product_technical_manager')
 )
$$;
revoke all on function private.can_create_assigned_lead_location() from public,anon,authenticated;
grant execute on function private.can_create_assigned_lead_location() to authenticated;

-- Own capability only: do not expose roster assignments or Auth account readiness data.
create function public.inventory_location_creation_context() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('user_id',auth.uid(),'assigned_lead',private.can_create_assigned_lead_location())
$$;
revoke all on function public.inventory_location_creation_context() from public,anon,authenticated;
grant execute on function public.inventory_location_creation_context() to authenticated;

-- Internal implementation called only from the existing authorized SECURITY DEFINER RPC.
-- It is deliberately SECURITY INVOKER and not executable by API roles.
create function private.create_assigned_lead_location(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 new_id uuid; parent public.locations; v_parent_id uuid:=nullif(p_data->>'parentId','')::uuid;
 v_area_id uuid:=nullif(p_data->>'areaId','')::uuid;
 location_name text:=trim(coalesce(p_data->>'name',''));
 location_kind text:=coalesce(p_data->>'kind','Storage');
 location_class text:=coalesce(p_data->>'classification','permanent');
begin
 -- Shared Team Management mutations take 4418; hierarchy changes take 4419.
 perform pg_advisory_xact_lock(4418);
 if not private.can_create_assigned_lead_location() then
  raise exception 'An active assigned student lead role is required to create storage locations' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(4419);
 if jsonb_typeof(p_data) is distinct from 'object' or exists(
  select 1 from jsonb_object_keys(p_data) key where key not in ('name','kind','classification','areaId','parentId','room','note')
 ) then raise exception 'Only normal storage location fields are accepted' using errcode='22023';end if;
 if length(location_name) not between 1 and 200 or length(coalesce(p_data->>'note',''))>10000 or length(coalesce(p_data->>'room',''))>200 then
  raise exception 'Enter a location name (up to 200 characters), room (up to 200) and instructions (up to 10000)' using errcode='22023';
 end if;
 if location_kind not in ('Storage','Side','Shelf','Bin','Drawer') or location_class not in ('permanent','project','robot','temporary','other') then
  raise exception 'Choose a normal storage location type and classification' using errcode='22023';
 end if;
 if v_area_id is not null and not exists(select 1 from public.areas a where a.id=v_area_id and a.active) then
  raise exception 'Choose an active team area' using errcode='22023';
 end if;
 if v_parent_id is not null then
  select * into parent from public.locations l where l.id=v_parent_id;
  if not found or parent.location_type in ('Drawer','Bin') or exists(
   with recursive ancestors as (
    select l.id,l.parent_id,l.active,l.trip_id,l.classification from public.locations l where l.id=v_parent_id
    union select l.id,l.parent_id,l.active,l.trip_id,l.classification from public.locations l join ancestors a on l.id=a.parent_id
   ) select 1 from ancestors where id='44180000-0000-4000-8000-000000000099'::uuid or not active or trip_id is not null or classification not in ('permanent','project','robot','temporary','other')
  ) then raise exception 'Choose an active normal storage parent, not a drawer, bin or travel location' using errcode='22023';end if;
 end if;
 insert into public.locations(name,code,parent_id,location_type,classification,area_id,description,room,storage)
 values(location_name,location_name,v_parent_id,location_kind,location_class,v_area_id,coalesce(p_data->>'note',''),
  case when v_parent_id is null then trim(coalesce(p_data->>'room','')) else parent.room end,
  case when v_parent_id is null then location_name else parent.name end) returning id into new_id;
 return jsonb_build_object('id',new_id);
end
$$;
revoke all on function private.create_assigned_lead_location(jsonb) from public,anon,authenticated;

-- Preserve all other current RPC branches instead of replacing a stale full definition.
-- Abort, without applying any changes, if the expected insertion point has drifted.
do $migration$
declare definition text:=pg_get_functiondef('public.inventory_action(text,jsonb)'::regprocedure);
 anchor text:=$anchor$ if p_action='create_trip' then$anchor$;
 addition text:=$addition$ if p_action='create_location' and private.can_create_assigned_lead_location() then
  return private.create_assigned_lead_location(p_data);
 end if;
$addition$;
begin
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
  or position('private.create_assigned_lead_location' in definition)>0 then
  raise exception 'inventory_action has changed; review the location-creation migration before applying';
 end if;
 execute replace(definition,anchor,addition||anchor);
end
$migration$;
commit;
