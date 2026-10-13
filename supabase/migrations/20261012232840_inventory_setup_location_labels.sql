begin;
-- Additive setup/label upgrade. Do not infer a stocking decision from legacy zero thresholds.
-- ALTER COLUMN defaults backfill only the added columns, without firing row-update triggers.
lock table public.inventory_items, public.locations in access exclusive mode;
alter table public.inventory_items
 add column restock_policy text not null default 'unset'
 constraint inventory_items_restock_policy_check check (restock_policy in ('unset','restock','do_not_restock'));
alter table public.locations
 add column label_code text not null default ('L-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)))
 constraint locations_label_code_format check (label_code ~ '^L-[0-9A-F]{12}$'),
 add constraint locations_label_code_unique unique (label_code);

comment on column public.inventory_items.restock_policy is
 'Explicit stocking decision. unset includes legacy rows; zero minimum/target never imply do_not_restock.';
comment on column public.locations.label_code is
 'Stable immutable physical-label identifier; lookup through existing authenticated location SELECT policy.';

-- Keep validation at the table boundary, including direct REST writes and CSV/import patches.
-- The existing guard_item dynamically compares metadata, so new policy edits retain can_edit rights.
create function private.validate_item_restock() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.restock_policy is null or new.restock_policy not in ('unset','restock','do_not_restock') then
  raise exception 'Choose a valid restock policy' using errcode='23514';
 end if;
 if new.minimum_quantity is null or new.minimum_quantity < 0 or not (new.minimum_quantity < 'Infinity'::numeric)
  or new.target_quantity is null or new.target_quantity < 0 or not (new.target_quantity < 'Infinity'::numeric) then
  raise exception 'Minimum and target must be finite nonnegative quantities' using errcode='23514';
 end if;
 if new.restock_policy='restock' and new.target_quantity <= new.minimum_quantity then
  raise exception 'Restock target must be greater than minimum' using errcode='23514';
 end if;
 return new;
end $$;
create trigger validate_item_restock before insert or update on public.inventory_items
 for each row execute function private.validate_item_restock();

create function private.guard_location_label() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.label_code is distinct from old.label_code then
  raise exception 'Location label identity is immutable' using errcode='42501';
 end if;
 return new;
end $$;
create trigger guard_location_label before update on public.locations
 for each row execute function private.guard_location_label();
revoke all on function private.validate_item_restock(), private.guard_location_label() from public, anon, authenticated;

-- Setup is metadata-only. A count/verification remains its own explicit existing workflow.
create function public.setup_inventory_item(
 p_id uuid,
 p_expected_updated_at timestamptz,
 p_policy text,
 p_minimum numeric,
 p_target numeric
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_item public.inventory_items; saved public.inventory_items;
begin
 if private.current_role() is null then
  raise exception 'Authentication with an active profile is required' using errcode='42501';
 end if;
 if not private.can_count() then
  raise exception 'You do not have permission to set up inventory' using errcode='42501';
 end if;
 select * into current_item from public.inventory_items where id=p_id for update;
 if not found then
  raise exception 'This item was removed or is unavailable. Refresh and try again.' using errcode='40001';
 end if;
 if not coalesce(private.can_edit(current_item.area_id),false) then
  raise exception 'Only the assigned lead, admin or mentor can set up this item' using errcode='42501';
 end if;
 if p_expected_updated_at is null or current_item.updated_at is distinct from p_expected_updated_at then
  raise exception 'This item changed on another device. Refresh and try again.' using errcode='40001';
 end if;
 update public.inventory_items
 set restock_policy=p_policy,minimum_quantity=p_minimum,target_quantity=p_target
 where id=current_item.id returning * into saved;
 return jsonb_build_object('item',to_jsonb(saved));
end $$;

-- Separate from inventory_features()/logistics migration versions for backwards compatibility.
create function public.inventory_setup_features() returns integer
language plpgsql stable security invoker set search_path='' as $$
begin
 if private.current_role() is null then
  raise exception 'Authentication with an active profile is required' using errcode='42501';
 end if;
 return 1;
end $$;
revoke all on function public.setup_inventory_item(uuid,timestamptz,text,numeric,numeric), public.inventory_setup_features() from public, anon;
grant execute on function public.setup_inventory_item(uuid,timestamptz,text,numeric,numeric), public.inventory_setup_features() to authenticated;

-- Preserve the existing generic transactional editor/import contract. Missing policy keys retain
-- the row's value during update and become unset only for new items. Explicit null is invalid.
-- Location label_code is intentionally absent: upserts preserve existing physical labels.
create or replace function public.apply_inventory_changes(p_changes jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare r jsonb; payload jsonb; existing public.inventory_items; value public.inventory_items;
begin
 for r in select * from jsonb_array_elements(coalesce(p_changes->'areas','[]')) loop
  payload:=r->'record';
  insert into public.areas(id,slug,name,lead_name,active) values((payload->>'id')::uuid,payload->>'slug',payload->>'name',coalesce(payload->>'lead_name',''),true)
  on conflict(id) do update set name=excluded.name,lead_name=excluded.lead_name,updated_at=clock_timestamp();
 end loop;
 for r in select * from jsonb_array_elements(coalesce(p_changes->'locations','[]')) loop
  payload:=r->'record';
  insert into public.locations(id,name,code,parent_id,location_type,description,room,storage,classification,area_id) values((payload->>'id')::uuid,payload->>'name',payload->>'code',(payload->>'parent_id')::uuid,payload->>'location_type',payload->>'description',coalesce(payload->>'room',''),coalesce(payload->>'storage',''),coalesce(payload->>'classification','permanent'),nullif(payload->>'area_id','')::uuid)
  on conflict(id) do update set name=excluded.name,code=excluded.code,parent_id=excluded.parent_id,location_type=excluded.location_type,description=excluded.description,room=excluded.room,storage=excluded.storage,classification=excluded.classification,area_id=excluded.area_id;
 end loop;
 for r in select * from jsonb_array_elements(coalesce(p_changes->'categories','[]')) loop
  insert into public.categories(name) values(r#>>'{}') on conflict do nothing;
 end loop;
 for r in select * from jsonb_array_elements(coalesce(p_changes->'items','[]')) loop
  payload:=r->'record';
  select * into existing from public.inventory_items where id=(payload->>'id')::uuid for update;
  if found then
   if r->>'expected_updated_at' is null or existing.updated_at<>(r->>'expected_updated_at')::timestamptz then raise exception 'An item changed on another device. Refresh and retry.' using errcode='40001';end if;
   value:=jsonb_populate_record(existing,payload);
   update public.inventory_items set name=value.name,item_type=value.item_type,ownership=value.ownership,area_id=value.area_id,category=value.category,quantity=value.quantity,expected_quantity=value.expected_quantity,minimum_quantity=value.minimum_quantity,target_quantity=value.target_quantity,unit=value.unit,location_id=value.location_id,slot_position=value.slot_position,manufacturer=value.manufacturer,manufacturer_part_number=value.manufacturer_part_number,vendor=value.vendor,vendor_url=value.vendor_url,approx_unit_cost=value.approx_unit_cost,notes=value.notes,last_verified_at=value.last_verified_at,legacy_updated_by=value.legacy_updated_by,order_status=value.order_status,tracking_mode=value.tracking_mode,restock_policy=value.restock_policy where id=existing.id;
  else
   if r->>'expected_updated_at' is not null then raise exception 'An item was removed on another device. Refresh and retry.' using errcode='40001';end if;
   value:=jsonb_populate_record(null::public.inventory_items,payload);
   insert into public.inventory_items(id,name,item_type,ownership,area_id,category,quantity,expected_quantity,minimum_quantity,target_quantity,unit,location_id,slot_position,manufacturer,manufacturer_part_number,vendor,vendor_url,approx_unit_cost,notes,last_verified_at,legacy_updated_by,order_status,tracking_mode,restock_policy)
   values(value.id,value.name,value.item_type,value.ownership,value.area_id,value.category,value.quantity,value.expected_quantity,value.minimum_quantity,value.target_quantity,value.unit,value.location_id,value.slot_position,value.manufacturer,value.manufacturer_part_number,value.vendor,value.vendor_url,value.approx_unit_cost,value.notes,value.last_verified_at,value.legacy_updated_by,value.order_status,value.tracking_mode,case when payload ? 'restock_policy' then value.restock_policy else 'unset' end);
  end if;
 end loop;
 for r in select * from jsonb_array_elements(coalesce(p_changes->'deleted_items','[]')) loop
  select * into existing from public.inventory_items where id=(r->>'id')::uuid for update;
  if not found or r->>'updated_at' is null or existing.updated_at<>(r->>'updated_at')::timestamptz then raise exception 'An item changed on another device. Refresh and retry.' using errcode='40001';end if;
  delete from public.inventory_items where id=existing.id;
 end loop;
end $$;

commit;
