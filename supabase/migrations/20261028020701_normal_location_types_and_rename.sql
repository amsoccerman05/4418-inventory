-- MANUAL ROLLOUT ONLY after approval of the added name-only rename permission.
-- Apply after 20261028011601_assigned_student_lead_location_creation.sql.
-- Add physical storage types, not team areas or usage classifications.
begin;
alter table public.locations drop constraint locations_location_type_check,
 add constraint locations_location_type_check check(location_type in ('Storage','Closet','Toolbox','Box','Side','Shelf','Bin','Drawer'));

-- Extend only the existing normal-creation helper. Admins already have location
-- creation rights; the new structured form uses the same validated normal path.
do $migration$
declare definition text:=pg_get_functiondef('private.create_assigned_lead_location(jsonb)'::regprocedure);
 kinds text:=$kinds$('Storage','Side','Shelf','Bin','Drawer')$kinds$;
 guard text:=$guard$if not private.can_create_assigned_lead_location() then$guard$;
 name_guard text:='if length(location_name) not between 1 and 200 or length(';
begin
 if (length(definition)-length(replace(definition,kinds,'')))/length(kinds)<>1
  or (length(definition)-length(replace(definition,guard,'')))/length(guard)<>1
  or (length(definition)-length(replace(definition,name_guard,'')))/length(name_guard)<>1 then
  raise exception 'Normal location creation helper changed; review before applying';
 end if;
 definition:=replace(definition,kinds,$kinds$('Storage','Closet','Toolbox','Box','Side','Shelf','Bin','Drawer')$kinds$);
 definition:=replace(definition,guard,'if not (private.is_admin() or private.can_create_assigned_lead_location()) then');
 definition:=replace(definition,name_guard,$check$if length(location_name) not between 1 and 200 or location_name !~ '[^[:space:]]' or location_name ~ '[[:cntrl:]]' or length($check$);
 execute definition;
end
$migration$;

create function private.rename_inventory_location(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare target public.locations; target_id uuid:=nullif(p_data->>'id','')::uuid;
 expected timestamptz:=nullif(p_data->>'updatedAt','')::timestamptz;
 next_name text:=trim(coalesce(p_data->>'name',''));
begin
 perform pg_advisory_xact_lock(4418);
 if not (private.is_admin() or private.can_create_assigned_lead_location()) then
  raise exception 'An active assigned student lead, admin or mentor is required to rename locations' using errcode='42501';
 end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(
  select 1 from jsonb_object_keys(p_data) key where key not in ('id','name','updatedAt')
 ) then raise exception 'Renaming changes only the location name' using errcode='22023';end if;
 if length(next_name) not between 1 and 200 or next_name !~ '[^[:space:]]' or next_name ~ '[[:cntrl:]]' then raise exception 'Enter a location name up to 200 characters' using errcode='22023';end if;
 perform pg_advisory_xact_lock(4419);
 select * into target from public.locations l where l.id=target_id for update;
 if not found or exists(
  with recursive ancestors as (
   select l.id,l.parent_id,l.active,l.trip_id,l.classification from public.locations l where l.id=target_id
   union select l.id,l.parent_id,l.active,l.trip_id,l.classification from public.locations l join ancestors a on l.id=a.parent_id
  ) select 1 from ancestors where id='44180000-0000-4000-8000-000000000099'::uuid or not active
   or trip_id is not null or classification not in ('permanent','project','robot','temporary','other')
 ) then raise exception 'Only active normal storage locations can be renamed' using errcode='42501';end if;
 if expected is null or target.updated_at is distinct from expected then
  raise exception 'This location changed. Close and reopen Rename before trying again.' using errcode='40001';
 end if;
 if target.name is distinct from next_name then update public.locations set name=next_name where id=target.id;end if;
 return jsonb_build_object('id',target.id);
end
$$;
revoke all on function private.rename_inventory_location(jsonb) from public,anon,authenticated;

-- Admin-only normal-storage settings. Assigned student leaders do not gain this action.
create function private.configure_inventory_location(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare target public.locations; target_id uuid:=nullif(p_data->>'id','')::uuid;
 expected timestamptz:=nullif(p_data->>'updatedAt','')::timestamptz;
 next_kind text:=p_data->>'kind'; next_class text:=p_data->>'classification';
begin
 if not private.is_admin() then raise exception 'Only admins and mentors can change storage settings' using errcode='42501';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(
  select 1 from jsonb_object_keys(p_data) key where key not in ('id','kind','classification','updatedAt')
 ) then raise exception 'Storage settings change only type and use' using errcode='22023';end if;
 if next_kind is null or next_kind not in ('Storage','Closet','Toolbox','Box','Side','Shelf','Bin','Drawer')
  or next_class is null or next_class not in ('permanent','project','robot','temporary','other') then
  raise exception 'Choose a normal storage type and use' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(4419);
 select * into target from public.locations l where l.id=target_id for update;
 if not found or exists(
  with recursive ancestors as (
   select l.id,l.parent_id,l.active,l.trip_id,l.classification from public.locations l where l.id=target_id
   union select l.id,l.parent_id,l.active,l.trip_id,l.classification from public.locations l join ancestors a on l.id=a.parent_id
  ) select 1 from ancestors where id='44180000-0000-4000-8000-000000000099'::uuid or not active
   or trip_id is not null or classification not in ('permanent','project','robot','temporary','other')
 ) then raise exception 'Only active normal storage locations can be configured' using errcode='42501';end if;
 if expected is null or target.updated_at is distinct from expected then
  raise exception 'This location changed. Close and reopen storage settings before trying again.' using errcode='40001';
 end if;
 if next_kind in ('Drawer','Bin') and exists(select 1 from public.locations l where l.parent_id=target.id) then
  raise exception 'A location with child locations cannot become a drawer or bin' using errcode='22023';
 end if;
 if target.location_type is distinct from next_kind or target.classification is distinct from next_class then
  update public.locations set location_type=next_kind,classification=next_class where id=target.id;
 end if;
 return jsonb_build_object('id',target.id);
end
$$;
revoke all on function private.configure_inventory_location(jsonb) from public,anon,authenticated;

-- Existing legacy account-lead creation remains unchanged. No direct UPDATE policy
-- is granted; assigned students gain no type, hierarchy, area, code, active-state or deletion rights.
do $migration$
declare definition text:=pg_get_functiondef('public.inventory_action(text,jsonb)'::regprocedure);
 anchor text:=$anchor$ if p_action='create_trip' then$anchor$;
 addition text:=$addition$ if p_action='configure_location' then
  return private.configure_inventory_location(p_data);
 end if;
 if p_action='rename_location' then
  return private.rename_inventory_location(p_data);
 end if;
 if p_action='create_location' and private.is_admin() and (p_data ? 'kind' or p_data ? 'parentId') then
  return private.create_assigned_lead_location(p_data);
 end if;
$addition$;
begin
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
  or position('private.rename_inventory_location' in definition)>0 then
  raise exception 'inventory_action has changed; review the rename migration before applying';
 end if;
 execute replace(definition,anchor,addition||anchor);
end
$migration$;
commit;
