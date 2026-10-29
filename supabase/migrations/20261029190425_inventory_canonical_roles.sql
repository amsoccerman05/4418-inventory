-- Approved canonical roles and everyday Inventory editing.
-- Requires Hub's explicit legacy-account conversion and canonical five-role CHECK.
-- Students edit item details/photos in all areas, but cannot create locations.
-- Lead/Admin Lead create normal locations across areas. Admin Lead may name-only
-- rename them. Existing assigned Student/Lead rename authority is preserved.
-- Deletion, location photos/settings, trips/import/loss resolution are NOT broadened.
-- No profile/position/business-data updates. New private helpers have explicit ACLs.
begin;
select pg_advisory_xact_lock(4418);
do $canonical_guard$ begin
 if not exists(select 1 from pg_constraint where conrelid=to_regclass('public.profiles') and conname='profiles_role_check' and contype='c' and convalidated and pg_get_constraintdef(oid)='CHECK ((role = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''mentor''::text])))') then raise exception 'Inventory requires the reviewed canonical five-role CHECK';end if;
 if exists(select 1 from public.profiles where role::text='admin') then raise exception 'Legacy Owner Admin account must be explicitly converted by Hub first';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.is_admin()') and md5(pg_get_functiondef(oid))='4c52312892ffb51d1a98a667ca75ac82' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Inventory function/ACL drift: private.is_admin()';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.can_count()') and md5(pg_get_functiondef(oid))='e55d4ae6c0b0426bfca7b8525950951a' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Inventory function/ACL drift: private.can_count()';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.change_inventory_quantity(uuid,numeric,numeric,timestamp with time zone,boolean)') and md5(pg_get_functiondef(oid))='8d2541501195cd9a3fcc025b8045f14a' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Inventory function/ACL drift: public.change_inventory_quantity(uuid,numeric,numeric,timestamp with time zone,boolean)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.verify_balance_location(uuid,jsonb)') and md5(pg_get_functiondef(oid))='4805c944675d74537c1e985e7e180a7f' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Inventory function/ACL drift: public.verify_balance_location(uuid,jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.can_edit(uuid)') and md5(pg_get_functiondef(oid))='54c7476cc03f4f05cb24243396f04937' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Inventory function/ACL drift: private.can_edit(uuid)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.guard_item()') and md5(pg_get_functiondef(oid))='ca3f05eba027f8de555c5c4059a74330' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}') then raise exception 'Inventory function/ACL drift: private.guard_item()';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.inventory_action(text,jsonb)') and md5(pg_get_functiondef(oid))='0a5eec387ddbd4bfe136695765e039cc' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Inventory function/ACL drift: public.inventory_action(text,jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.create_assigned_lead_location(jsonb)') and md5(pg_get_functiondef(oid))='af27f00d25a04a0639d27f4e5ffa2205' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}') then raise exception 'Inventory function/ACL drift: private.create_assigned_lead_location(jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.rename_inventory_location(jsonb)') and md5(pg_get_functiondef(oid))='bf0ea847fc2463634b452397f5ae1c39' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}') then raise exception 'Inventory function/ACL drift: private.rename_inventory_location(jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.configure_inventory_location(jsonb)') and md5(pg_get_functiondef(oid))='7a0da1c4fab330d5af5a14f640f42c09' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}') then raise exception 'Inventory function/ACL drift: private.configure_inventory_location(jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.inventory_location_creation_context()') and md5(pg_get_functiondef(oid))='8ae026882c747e6258cfc76e51b4f0f5' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Inventory function/ACL drift: public.inventory_location_creation_context()';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.can_manage_media(text,uuid)') and md5(pg_get_functiondef(oid))='6e47c64935af7dcdc5faf04cda419265' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Inventory function/ACL drift: private.can_manage_media(text,uuid)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.can_manage_media_path(text)') and md5(pg_get_functiondef(oid))='5a705111cf6f23937c20e467d000e04a' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Inventory function/ACL drift: private.can_manage_media_path(text)';end if;
 if to_regprocedure('private.can_delete_item(uuid)') is not null then raise exception 'Unexpected existing helper: private.can_delete_item(uuid)';end if;
 if to_regprocedure('private.can_rename_location()') is not null then raise exception 'Unexpected existing helper: private.can_rename_location()';end if;
 if to_regprocedure('private.can_create_location()') is not null then raise exception 'Unexpected existing helper: private.can_create_location()';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='public' and tablename='inventory_items' and policyname='items_delete') is distinct from '{"cmd":"DELETE","qual":"private.can_edit(area_id)","roles":["authenticated"],"tablename":"inventory_items","permissive":"PERMISSIVE","policyname":"items_delete","schemaname":"public","with_check":null}'::jsonb then raise exception 'Inventory policy drift: inventory_items.items_delete';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='storage' and tablename='objects' and policyname='inventory_media_delete') is distinct from '{"cmd":"DELETE","qual":"((bucket_id = ''inventory-media''::text) AND private.can_manage_media_path(name))","roles":["authenticated"],"tablename":"objects","permissive":"PERMISSIVE","policyname":"inventory_media_delete","schemaname":"storage","with_check":null}'::jsonb then raise exception 'Inventory policy drift: objects.inventory_media_delete';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='storage' and tablename='objects' and policyname='inventory_media_update') is distinct from '{"cmd":"UPDATE","qual":"((bucket_id = ''inventory-media''::text) AND private.can_manage_media_path(name))","roles":["authenticated"],"tablename":"objects","permissive":"PERMISSIVE","policyname":"inventory_media_update","schemaname":"storage","with_check":"((bucket_id = ''inventory-media''::text) AND private.can_manage_media_path(name))"}'::jsonb then raise exception 'Inventory policy drift: objects.inventory_media_update';end if;
end $canonical_guard$;
CREATE FUNCTION private.can_delete_item(area uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare actor public.profiles;
begin
 -- A role revocation that owns this row first is observed after waiting; an
 -- authorized delete pins its role/area until commit, not merely KEY SHARE.
 select * into actor from public.profiles where id=auth.uid() and active for share;
 if not found then return false;end if;
 return actor.role::text='mentor' or (actor.role::text in ('lead','admin_lead') and area=actor.primary_area_id);
end
$function$;
revoke all on function private.can_delete_item(uuid) from public,anon;
grant execute on function private.can_delete_item(uuid) to authenticated;

CREATE FUNCTION private.can_rename_location()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 select coalesce(private.current_role() in ('admin_lead','mentor'),false) or private.can_create_assigned_lead_location()
$function$;
revoke all on function private.can_rename_location() from public,anon;
grant execute on function private.can_rename_location() to authenticated;

CREATE FUNCTION private.can_create_location()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 select private.is_admin() or exists(
  select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=auth.uid() and p.active and p.role::text in ('lead','admin_lead')
   and u.email_confirmed_at is not null and u.last_sign_in_at is not null
   and (u.banned_until is null or u.banned_until<=now())
 )
$function$;
revoke all on function private.can_create_location() from public,anon;
grant execute on function private.can_create_location() to authenticated;

CREATE OR REPLACE FUNCTION private.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(private.current_role() in ('mentor'),false)
$function$
;
CREATE OR REPLACE FUNCTION private.can_count()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(private.current_role() in ('student','lead','admin_lead','mentor'),false)
$function$
;
CREATE OR REPLACE FUNCTION public.change_inventory_quantity(p_id uuid, p_delta numeric DEFAULT NULL::numeric, p_quantity numeric DEFAULT NULL::numeric, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_verify boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_item public.inventory_items; saved public.inventory_items; amount numeric;
begin
 if not private.can_count() then raise exception 'You do not have permission to change quantities' using errcode='42501';end if;
 if (p_delta is null)=(p_quantity is null) then raise exception 'Provide a delta or an absolute quantity';end if;
 select * into strict current_item from public.inventory_items where id=p_id for update;
 -- Re-read committed authority after the item-lock wait; do not reuse a pre-wait helper result.
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('student','lead','admin_lead','mentor')) then
  raise exception 'You do not have permission to change inventory' using errcode='42501';
 end if;
 if p_delta is null and (p_expected_updated_at is null or current_item.updated_at<>p_expected_updated_at) then raise exception 'This item changed on another device. Refresh and try again.' using errcode='40001';end if;
 amount:=case when p_delta is null then p_quantity else greatest(0,current_item.quantity+p_delta) end;
 update public.inventory_items set quantity=amount,last_verified_at=case when p_verify then clock_timestamp() else last_verified_at end where id=p_id returning * into saved;
 return jsonb_build_object('before',current_item.quantity,'item',to_jsonb(saved));
end $function$
;
CREATE OR REPLACE FUNCTION public.verify_balance_location(p_location uuid, p_expected jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record;expected_count integer;
begin
 if not private.can_count() then raise exception 'No audit permission' using errcode='42501';end if;
 if not exists(select 1 from public.locations where id=p_location and active) then raise exception 'Location is archived';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_location::text,4418));
 perform 1 from public.inventory_items where location_id=p_location or id in(select inventory_item_id from public.inventory_balances where location_id=p_location and quantity>0) order by id for update;
 -- Re-read committed authority after the item-lock wait; do not reuse a pre-wait helper result.
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('student','lead','admin_lead','mentor')) then
  raise exception 'You do not have permission to change inventory' using errcode='42501';
 end if;
 select count(*) into expected_count from public.inventory_items where location_id=p_location or id in(select inventory_item_id from public.inventory_balances where location_id=p_location and quantity>0);
 if expected_count<>jsonb_array_length(p_expected) then raise exception 'Location contents changed. Review again.';end if;
 for r in select * from public.inventory_items where location_id=p_location or id in(select inventory_item_id from public.inventory_balances where location_id=p_location and quantity>0) loop
  if not exists(select 1 from jsonb_array_elements(p_expected) e where e->>'id'=r.id::text and (e->>'updated_at')::timestamptz=r.updated_at) then raise exception 'Location contents changed. Review again.';end if;
  insert into public.inventory_balances(inventory_item_id,location_id,quantity) values(r.id,p_location,0) on conflict do nothing;
  update public.inventory_balances set last_verified_at=clock_timestamp(),last_verified_by=auth.uid(),updated_at=clock_timestamp() where inventory_item_id=r.id and location_id=p_location;
  perform set_config('app.balance_sync','yes',true);
  perform set_config('app.drawer_audit','yes',true);
  update public.inventory_items set last_verified_at=case when location_id=p_location then clock_timestamp() else last_verified_at end where id=r.id;
  perform set_config('app.drawer_audit','',true);
  perform set_config('app.balance_sync','',true);
  if r.location_id is distinct from p_location then insert into public.inventory_events(inventory_item_id,item_name,area_id,user_id,event_type,notes) values(r.id,r.name,r.area_id,auth.uid(),'drawer_verified',p_location::text);end if;
 end loop;
end $function$
;
CREATE OR REPLACE FUNCTION private.can_edit(area uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select private.can_count()
$function$
;
CREATE OR REPLACE FUNCTION private.guard_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid := auth.uid();
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if tg_op='INSERT' or new.location_id is distinct from old.location_id then
  -- Serialize drawer membership changes with audit verification (including new arrivals).
  if new.location_id is not null then perform pg_advisory_xact_lock(hashtextextended(new.location_id::text,4418));end if;
  if tg_op='UPDATE' and old.location_id is not null then perform pg_advisory_xact_lock(hashtextextended(old.location_id::text,4418));end if;
 end if;
 -- Current authority is checked after business locks and held through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text in ('student','lead','admin_lead','mentor') for share;
 if not found then raise exception 'You cannot change inventory' using errcode='42501';end if;
 if tg_op='INSERT' then
  if not coalesce(private.can_create_item(new.area_id),false) then raise exception 'You cannot create items in this area' using errcode='42501';end if;
  new.created_by:=actor; new.created_at:=clock_timestamp();
  -- Imported historical verification dates may be preserved by mentors; no verifier is invented.
  new.last_verified_by:=null;
 else
  if not private.can_count() then raise exception 'You cannot change inventory' using errcode='42501';end if;
  if new.area_id is distinct from old.area_id and not private.is_admin() then raise exception 'Only a Mentor can reassign an existing item to another team area' using errcode='42501';end if;
  if new.id<>old.id or new.created_at<>old.created_at or new.created_by is distinct from old.created_by then raise exception 'Item identity is immutable' using errcode='42501';end if;
  if (to_jsonb(new)-array['quantity','last_verified_at','last_verified_by','updated_at','updated_by']) is distinct from (to_jsonb(old)-array['quantity','last_verified_at','last_verified_by','updated_at','updated_by']) then
   if not coalesce(private.can_edit(old.area_id) and private.can_edit(new.area_id),false) then raise exception 'An active Student, Lead, Admin Lead or Mentor is required to edit items' using errcode='42501';end if;
  end if;
  if new.last_verified_at is distinct from old.last_verified_at then new.last_verified_at:=clock_timestamp();new.last_verified_by:=actor;
  else new.last_verified_by:=old.last_verified_by;end if;
 end if;
 new.updated_by:=actor;new.updated_at:=clock_timestamp();return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.inventory_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); i public.inventory_items; t public.trips; m public.trip_manifest_items; source public.locations; dest public.locations;
 iid uuid;tid uuid;src uuid;dst uuid;mid uuid; qty numeric;have numeric;other numeric;new_id uuid;note text:=coalesce(p_data->>'note','');action_type text;new_status text;part record;oldqty numeric;
begin
 if not private.can_count() then raise exception 'You do not have permission for this action' using errcode='42501';end if;
 if p_action='create_location' then
  return private.create_assigned_lead_location(p_data);
 end if;
 if p_action='configure_location' then
  return private.configure_inventory_location(p_data);
 end if;
 if p_action='rename_location' then
  return private.rename_inventory_location(p_data);
 end if;
 if p_action='create_trip' then
  if not private.is_admin() then raise exception 'Only mentors create trips' using errcode='42501';end if;
  insert into public.trips(name,event_name,destination,start_date,end_date,notes,created_by) values(trim(p_data->>'name'),coalesce(p_data->>'event',''),coalesce(p_data->>'destination',''),nullif(p_data->>'start','')::date,nullif(p_data->>'end','')::date,note,actor) returning id into tid;
  insert into public.locations(name,code,location_type,classification,trip_id) values(p_data->>'name',p_data->>'name','Storage','travel',tid) returning id into src;
  foreach action_type in array array['Trailer','Pit Toolbox A','Pit Toolbox B','Robot Cart','Programming Case','Battery Cart'] loop
   insert into public.locations(name,code,location_type,parent_id,classification,trip_id) values(action_type,action_type,'Storage',src,'travel',tid);
  end loop;return jsonb_build_object('id',tid);
 end if;
 tid:=nullif(p_data->>'tripId','')::uuid;mid:=nullif(p_data->>'manifestId','')::uuid;
 if mid is not null then select trip_id into strict tid from public.trip_manifest_items where id=mid;end if;
 if tid is not null then
  select * into strict t from public.trips where id=tid for update;
  if t.status in ('closed','cancelled') then raise exception 'This trip is archived';end if;
 end if;
 if p_action='trip_status' then
  if not private.is_admin() then raise exception 'Only mentors manage trips' using errcode='42501';end if;
  new_status:=p_data->>'status';
  if new_status in ('closed','cancelled') then
   if exists(select 1 from public.trip_manifest_items where trip_id=tid and status in ('approved','packed')) then raise exception 'Unresolved manifest items remain. Return them or explicitly resolve each item first.';end if;
   if exists(select 1 from public.inventory_balances b join public.locations l on l.id=b.location_id where l.trip_id=tid and b.quantity>0) then raise exception 'Travel locations still contain stock';end if;
   perform set_config('app.trip_write','yes',true);update public.locations set active=false where trip_id=tid;perform set_config('app.trip_write','',true);
  end if;
  update public.trips set status=new_status,updated_at=clock_timestamp(),notes=notes||case when note<>'' then E'\n'||note else '' end where id=tid;
  insert into public.inventory_movements(item_name,quantity,trip_id,movement_type,user_id,note) values(t.name,0,tid,'resolution',actor,'Trip status: '||new_status||'. '||note);
  return '{}'::jsonb;
 end if;
 if p_action in ('pack','internal','return','resolve') and mid is null then raise exception 'An approved manifest allocation is required';end if;
 iid:=nullif(p_data->>'itemId','')::uuid;
 if mid is not null then select * into strict m from public.trip_manifest_items where id=mid for update;iid:=m.inventory_item_id;end if;
 select * into strict i from public.inventory_items where id=iid for update;
 -- Re-read committed authority after the item-lock wait; do not reuse a pre-wait helper result.
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('student','lead','admin_lead','mentor')) then
  raise exception 'You do not have permission to change inventory' using errcode='42501';
 end if;
 qty:=(p_data->>'quantity')::numeric;src:=nullif(p_data->>'from','')::uuid;dst:=nullif(p_data->>'to','')::uuid;
 if mid is not null then src:=case when m.status='approved' then m.home_location_id else m.current_location_id end;end if;
 if p_action='return' then dst:=m.home_location_id;end if;
 if p_action='pack' then dst:=m.current_location_id;end if;
 if p_action in ('approve','pack','internal','return','resolve') and tid is null then raise exception 'A trip is required';end if;
 if p_action in ('pack','internal','return') and t.status='planning' then raise exception 'Start packing before moving trip inventory';end if;
 if p_action='approve' then
  if not(private.is_admin() or private.current_role() in ('lead','admin_lead')) then raise exception 'A lead or mentor must approve manifest items' using errcode='42501';end if;
  if t.status not in ('planning','packing') then raise exception 'Approve items during planning or packing';end if;
 end if;
 if p_action='resolve' then
  if not private.is_admin() or trim(note)='' then raise exception 'A mentor and a resolution note are required';end if;
  if m.status not in ('approved','packed') then raise exception 'This allocation is already resolved';end if;
  if m.status='approved' then
   if qty is null or qty<=0 or qty>m.quantity then raise exception 'Quantity exceeds this approval';end if;
   if qty<m.quantity then
    update public.trip_manifest_items set quantity=quantity-qty,updated_at=clock_timestamp() where id=mid;
    insert into public.trip_manifest_items(trip_id,inventory_item_id,quantity,home_location_id,current_location_id,ownership,status,resolution,notes) values(tid,i.id,qty,m.home_location_id,m.current_location_id,m.ownership,'resolved','Not packed: '||note,m.notes);
   else update public.trip_manifest_items set status='resolved',resolution='Not packed: '||note,updated_at=clock_timestamp() where id=mid;end if;
   insert into public.inventory_movements(inventory_item_id,item_name,quantity,trip_id,movement_type,user_id,note) values(i.id,i.name,0,tid,'resolution',actor,'Unpacked approval resolved: '||note);return '{}'::jsonb;
  end if;
  if p_data->>'resolution' not in ('lost','consumed','transferred','manual') then raise exception 'Choose a resolution';end if;
  if p_data->>'resolution' in ('lost','consumed') then dst:=null;elsif dst is null then raise exception 'Select the actual non-travel destination';end if;
 end if;
 select coalesce(sum(quantity),0) into have from public.inventory_balances where inventory_item_id=i.id and location_id=src;
 if p_action='adjust' and p_data->>'delta' is not null then qty:=greatest(0,have+(p_data->>'delta')::numeric);end if;
 if p_action='adjust' then
  if qty is null or qty<0 or qty>='Infinity'::numeric then raise exception 'Enter a finite nonnegative count';end if;
 else
  if qty is null or qty<=0 or qty>='Infinity'::numeric then raise exception 'Enter a finite quantity greater than zero';end if;
 end if;
 select * into strict source from public.locations where id=src and active for share;
 if dst is not null then select * into strict dest from public.locations where id=dst and active for share;end if;
 if p_action in ('move','adjust') and (source.trip_id is not null or dest.trip_id is not null) then raise exception 'Use the trip manifest for travel inventory';end if;
 if p_action='approve' and (source.trip_id is not null or dest.trip_id is distinct from tid) then raise exception 'Choose a non-travel home and a location in this trip';end if;
 if p_action in ('pack','internal') and dest.trip_id is distinct from tid then raise exception 'Destination must belong to this trip';end if;
 if p_action in ('internal','return','resolve') and source.trip_id is distinct from tid then raise exception 'Source must belong to this trip';end if;
 if p_action='resolve' and dst is not null and dest.trip_id is not null then raise exception 'Resolve to a non-travel location';end if;
 if p_action='approve' then
  insert into public.trip_manifest_items(trip_id,inventory_item_id,quantity,home_location_id,current_location_id,ownership,status,notes) values(tid,i.id,qty,src,dst,i.ownership,'approved',note) returning id into new_id;
  insert into public.inventory_movements(inventory_item_id,item_name,quantity,trip_id,movement_type,user_id,note) values(i.id,i.name,0,tid,'resolution',actor,'Approved '||qty||' for packing. '||note);return jsonb_build_object('id',new_id);
 end if;
 select coalesce(sum(quantity),0) into have from public.inventory_balances where inventory_item_id=i.id and location_id=src;
 if p_action='adjust' then
  if p_data->>'delta' is null and i.updated_at is distinct from (p_data->>'updatedAt')::timestamptz then raise exception 'Item changed. Review the latest counts before correcting.' using errcode='40001';end if;
  perform private.balance_set(i.id,src,qty);
  insert into public.inventory_movements(inventory_item_id,item_name,quantity,from_location_id,to_location_id,movement_type,user_id,note) values(i.id,i.name,abs(qty-have),case when qty<have then src end,case when qty>have then src end,'adjustment',actor,note);
  if coalesce((p_data->>'verify')::boolean,false) then update public.inventory_balances set last_verified_at=clock_timestamp(),last_verified_by=actor where inventory_item_id=i.id and location_id=src;end if;
  perform private.balance_sync(i.id);
  if coalesce((p_data->>'verify')::boolean,false) then
   if i.location_id is distinct from src then insert into public.inventory_events(inventory_item_id,item_name,area_id,user_id,event_type,notes) values(i.id,i.name,i.area_id,actor,'item_verified',src::text);end if;
   if i.location_id=src then perform set_config('app.balance_sync','yes',true);update public.inventory_items set last_verified_at=clock_timestamp() where id=i.id;perform set_config('app.balance_sync','',true);end if;
  end if;
  return jsonb_build_object('before',have,'quantity',qty,'item',(select to_jsonb(x) from public.inventory_items x where id=i.id));
 end if;
 if dst is null and p_action<>'resolve' then raise exception 'A destination is required';end if;
 if src=dst then raise exception 'Source and destination must differ';end if;
 if qty>have then raise exception 'Not enough quantity at the source';end if;
 if p_action in ('pack','internal','return','resolve') then
  if (p_action='pack' and m.status<>'approved') or (p_action<>'pack' and m.status<>'packed') or qty>m.quantity then raise exception 'Allocation changed or quantity exceeds this manifest allocation';end if;
  new_status:=case when p_action='return' then 'returned' when p_action='resolve' then 'resolved' else 'packed' end;
  if qty<m.quantity then
   update public.trip_manifest_items set quantity=quantity-qty,updated_at=clock_timestamp() where id=mid;
   insert into public.trip_manifest_items(trip_id,inventory_item_id,quantity,home_location_id,current_location_id,ownership,status,resolution,notes) values(tid,i.id,qty,m.home_location_id,coalesce(dst,src),m.ownership,new_status,case when p_action='resolve' then (p_data->>'resolution')||': '||note else '' end,m.notes);
  else update public.trip_manifest_items set current_location_id=coalesce(dst,src),status=new_status,resolution=case when p_action='resolve' then (p_data->>'resolution')||': '||note else '' end,updated_at=clock_timestamp() where id=mid;end if;
 end if;
 action_type:=case p_action when 'move' then 'transfer' when 'pack' then 'trip_pack' when 'internal' then 'trip_internal_move' when 'return' then 'trip_return' when 'resolve' then 'resolution' else null end;
 if action_type is null then raise exception 'Unknown inventory action';end if;
 perform private.balance_set(i.id,src,have-qty);
 if dst is not null then
  select coalesce(sum(quantity),0) into other from public.inventory_balances where inventory_item_id=i.id and location_id=dst;perform private.balance_set(i.id,dst,other+qty);
 end if;
 insert into public.inventory_movements(inventory_item_id,item_name,quantity,from_location_id,to_location_id,trip_id,movement_type,user_id,note) values(i.id,i.name,qty,src,dst,tid,action_type,actor,case when p_action='resolve' then (p_data->>'resolution')||': ' else '' end||note);
 perform private.balance_sync(i.id);
 return '{}'::jsonb;
end $function$
;
CREATE OR REPLACE FUNCTION private.create_assigned_lead_location(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 new_id uuid; parent public.locations; v_parent_id uuid:=nullif(p_data->>'parentId','')::uuid;
 v_area_id uuid:=nullif(p_data->>'areaId','')::uuid;
 location_name text:=trim(coalesce(p_data->>'name',''));
 location_kind text:=coalesce(p_data->>'kind','Storage');
 location_class text:=coalesce(p_data->>'classification','permanent');
begin
 -- Shared Team Management mutations take 4418; hierarchy changes take 4419.
 perform pg_advisory_xact_lock(4418);
 if not private.can_create_location() then
  raise exception 'An active Lead, Admin Lead or Mentor is required to create locations' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(4419);
 if jsonb_typeof(p_data) is distinct from 'object' or exists(
  select 1 from jsonb_object_keys(p_data) key where key not in ('name','kind','classification','areaId','parentId','room','note')
 ) then raise exception 'Only normal storage location fields are accepted' using errcode='22023';end if;
 if length(location_name) not between 1 and 200 or location_name !~ '[^[:space:]]' or location_name ~ '[[:cntrl:]]' or length(coalesce(p_data->>'note',''))>10000 or length(coalesce(p_data->>'room',''))>200 then
  raise exception 'Enter a location name (up to 200 characters), room (up to 200) and instructions (up to 10000)' using errcode='22023';
 end if;
 if location_kind not in ('Storage','Closet','Toolbox','Box','Side','Shelf','Bin','Drawer') or location_class not in ('permanent','project','robot','temporary','other') then
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
 -- Recheck role after both shared-role and location hierarchy locks.
 perform 1 from public.profiles where id=auth.uid() and active and role::text in ('lead','admin_lead','mentor') for share;
 if not found or not private.can_create_location() then raise exception 'An active confirmed Lead, Admin Lead or Mentor is required to create locations' using errcode='42501';end if;
 insert into public.locations(name,code,parent_id,location_type,classification,area_id,description,room,storage)
 values(location_name,location_name,v_parent_id,location_kind,location_class,v_area_id,coalesce(p_data->>'note',''),
  case when v_parent_id is null then trim(coalesce(p_data->>'room','')) else parent.room end,
  case when v_parent_id is null then location_name else parent.name end) returning id into new_id;
 return jsonb_build_object('id',new_id);
end
$function$
;
CREATE OR REPLACE FUNCTION private.rename_inventory_location(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare target public.locations; target_id uuid:=nullif(p_data->>'id','')::uuid;
 expected timestamptz:=nullif(p_data->>'updatedAt','')::timestamptz;
 next_name text:=trim(coalesce(p_data->>'name',''));
begin
 perform pg_advisory_xact_lock(4418);
 if not (private.can_rename_location()) then
  raise exception 'An Admin Lead, Mentor or active assigned functional lead is required to rename locations' using errcode='42501';
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
 -- A committed role/position loss while waiting cannot reuse earlier permission.
 perform 1 from public.profiles where id=auth.uid() and active and role::text in ('student','lead','admin_lead','mentor') for share;
 if not found then raise exception 'No permission to rename locations' using errcode='42501';end if;
 if private.current_role() in ('student','lead') then
  perform 1 from public.team_member_positions mp join public.team_positions pos on pos.key=mp.position_key and pos.active where mp.user_id=auth.uid() and mp.revoked_at is null for share of mp,pos;
 end if;
 if not private.can_rename_location() then raise exception 'No permission to rename locations' using errcode='42501';end if;
 if target.name is distinct from next_name then update public.locations set name=next_name where id=target.id;end if;
 return jsonb_build_object('id',target.id);
end
$function$
;
CREATE OR REPLACE FUNCTION private.configure_inventory_location(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare target public.locations; target_id uuid:=nullif(p_data->>'id','')::uuid;
 expected timestamptz:=nullif(p_data->>'updatedAt','')::timestamptz;
 next_kind text:=p_data->>'kind'; next_class text:=p_data->>'classification';
begin
 if not private.is_admin() then raise exception 'Only mentors can change storage settings' using errcode='42501';end if;
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
 -- Recheck Mentor authority after the hierarchy and target-row lock waits.
 perform 1 from public.profiles where id=auth.uid() and active and role::text='mentor' for share;
 if not found then raise exception 'Only mentors can change storage settings' using errcode='42501';end if;
 if target.location_type is distinct from next_kind or target.classification is distinct from next_class then
  update public.locations set location_type=next_kind,classification=next_class where id=target.id;
 end if;
 return jsonb_build_object('id',target.id);
end
$function$
;
CREATE OR REPLACE FUNCTION public.inventory_location_creation_context()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('user_id',auth.uid(),'assigned_lead',private.can_create_assigned_lead_location(),'can_create',private.can_create_location(),'can_rename',private.can_rename_location())
$function$
;
CREATE OR REPLACE FUNCTION private.can_manage_media(kind text, entity uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles;
begin
 -- Serialize photo authorization with role/area revocation for this transaction.
 select * into actor from public.profiles where id=auth.uid() and active for share;
 if not found then return false;end if;
 if kind='items' then
  return actor.role::text in ('student','lead','admin_lead','mentor') and exists(select 1 from public.inventory_items where id=entity);
 elsif kind='locations' then
  return exists(select 1 from public.locations where id=entity and (actor.role::text='mentor' or (actor.role::text in ('lead','admin_lead') and area_id=actor.primary_area_id)));
 end if;
 return false;
end
$function$
;
CREATE OR REPLACE FUNCTION private.can_manage_media_path(object_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 return private.can_manage_media(split_part(object_path,'/',1),split_part(object_path,'/',2)::uuid) and array_length(string_to_array(object_path,'/'),1)=3;
exception when invalid_text_representation then return false;
end $function$
;
alter policy items_delete on public.inventory_items using (private.can_delete_item(area_id));

alter policy inventory_media_delete on storage.objects using (((bucket_id = 'inventory-media'::text) AND private.can_manage_media_path(name)) AND NOT EXISTS (SELECT 1 FROM public.inventory_media m WHERE m.path = objects.name));

alter policy inventory_media_update on storage.objects using (((bucket_id = 'inventory-media'::text) AND private.can_manage_media_path(name)) AND NOT EXISTS (SELECT 1 FROM public.inventory_media m WHERE m.path = objects.name));

do $canonical_verify$ begin
 if md5(pg_get_functiondef('private.is_admin()'::regprocedure))<>'b9526e226d12d27b717f2f092e8def5b' then raise exception 'Inventory output mismatch: private.is_admin()';end if;
 if md5(pg_get_functiondef('private.can_count()'::regprocedure))<>'86ce8b0081117bd75b5951fec04360ac' then raise exception 'Inventory output mismatch: private.can_count()';end if;
 if md5(pg_get_functiondef('public.change_inventory_quantity(uuid,numeric,numeric,timestamp with time zone,boolean)'::regprocedure))<>'267269eb8d848d0f34ea928dbd58286e' then raise exception 'Inventory output mismatch: public.change_inventory_quantity(uuid,numeric,numeric,timestamp with time zone,boolean)';end if;
 if md5(pg_get_functiondef('public.verify_balance_location(uuid,jsonb)'::regprocedure))<>'0586174a7b772b581b6ca069010049b6' then raise exception 'Inventory output mismatch: public.verify_balance_location(uuid,jsonb)';end if;
 if md5(pg_get_functiondef('private.can_edit(uuid)'::regprocedure))<>'1a6504695c70b3f8c93bed851b02e566' then raise exception 'Inventory output mismatch: private.can_edit(uuid)';end if;
 if md5(pg_get_functiondef('private.guard_item()'::regprocedure))<>'90078304127911b399ec11dab8f26c9d' then raise exception 'Inventory output mismatch: private.guard_item()';end if;
 if md5(pg_get_functiondef('public.inventory_action(text,jsonb)'::regprocedure))<>'7634718f80bf56d6a7b80cc4ff6b155e' then raise exception 'Inventory output mismatch: public.inventory_action(text,jsonb)';end if;
 if md5(pg_get_functiondef('private.create_assigned_lead_location(jsonb)'::regprocedure))<>'2faa51790ae6e41f7afaecba48100122' then raise exception 'Inventory output mismatch: private.create_assigned_lead_location(jsonb)';end if;
 if md5(pg_get_functiondef('private.rename_inventory_location(jsonb)'::regprocedure))<>'bdbb906e44907392b33c69c52043d976' then raise exception 'Inventory output mismatch: private.rename_inventory_location(jsonb)';end if;
 if md5(pg_get_functiondef('private.configure_inventory_location(jsonb)'::regprocedure))<>'c6f10bd861c40774f2d6ae18bc9e93b5' then raise exception 'Inventory output mismatch: private.configure_inventory_location(jsonb)';end if;
 if md5(pg_get_functiondef('public.inventory_location_creation_context()'::regprocedure))<>'4c970523cf67099be2c17119e3b0b474' then raise exception 'Inventory output mismatch: public.inventory_location_creation_context()';end if;
 if md5(pg_get_functiondef('private.can_manage_media(text,uuid)'::regprocedure))<>'11f4ace69525fc4a9bcf827199dc638d' then raise exception 'Inventory output mismatch: private.can_manage_media(text,uuid)';end if;
 if md5(pg_get_functiondef('private.can_manage_media_path(text)'::regprocedure))<>'7e1b767a7dc92b108aaaa131c69b0bca' then raise exception 'Inventory output mismatch: private.can_manage_media_path(text)';end if;
end $canonical_verify$;
commit;
