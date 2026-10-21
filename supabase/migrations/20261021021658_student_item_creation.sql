begin;
-- Creation is distinct from editing. Existing lead area limits stay in can_edit.
create function private.can_create_item(area uuid) returns boolean language sql stable set search_path='' as $$
 select coalesce(private.current_role()='student',false) or coalesce(private.can_edit(area),false)
$$;
revoke all on function private.can_create_item(uuid) from public,anon;
grant execute on function private.can_create_item(uuid) to authenticated;
alter policy items_insert on public.inventory_items with check(private.can_create_item(area_id));

create or replace function private.guard_item() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if tg_op='INSERT' or new.location_id is distinct from old.location_id then
  -- Serialize drawer membership changes with audit verification (including new arrivals).
  if new.location_id is not null then perform pg_advisory_xact_lock(hashtextextended(new.location_id::text,4418));end if;
  if tg_op='UPDATE' and old.location_id is not null then perform pg_advisory_xact_lock(hashtextextended(old.location_id::text,4418));end if;
 end if;
 if tg_op='INSERT' then
  if not coalesce(private.can_create_item(new.area_id),false) then raise exception 'You cannot create items in this area' using errcode='42501';end if;
  new.created_by:=actor; new.created_at:=clock_timestamp();
  -- Imported historical verification dates may be preserved by admins; no verifier is invented.
  new.last_verified_by:=null;
 else
  if not private.can_count() then raise exception 'You cannot change inventory' using errcode='42501';end if;
  if new.id<>old.id or new.created_at<>old.created_at or new.created_by is distinct from old.created_by then raise exception 'Item identity is immutable' using errcode='42501';end if;
  if (to_jsonb(new)-array['quantity','last_verified_at','last_verified_by','updated_at','updated_by']) is distinct from (to_jsonb(old)-array['quantity','last_verified_at','last_verified_by','updated_at','updated_by']) then
   if not coalesce(private.can_edit(old.area_id) and private.can_edit(new.area_id),false) then raise exception 'Only the assigned lead, admin or mentor can edit item metadata' using errcode='42501';end if;
  end if;
  if new.last_verified_at is distinct from old.last_verified_at then new.last_verified_at:=clock_timestamp();new.last_verified_by:=actor;
  else new.last_verified_by:=old.last_verified_by;end if;
 end if;
 new.updated_by:=actor;new.updated_at:=clock_timestamp();return new;
end $$;
commit;
