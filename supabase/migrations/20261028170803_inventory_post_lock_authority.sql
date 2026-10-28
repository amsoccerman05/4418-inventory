-- Required regression repair: hosted native Auth/API proved a committed Readonly
-- demotion could be missed while these stock RPCs waited on an item row lock.
-- Preserve all security modes, ownership, ACLs, RLS and business rules. This is
-- a fresh post-wait authority check, not a global revocation linearization lock.
-- Apply after 20261028160648_inventory_admin_lead_compatibility.sql.
begin;
do $migration$
declare entry record; definition text;
begin
 for entry in select * from (values
  ('public.change_inventory_quantity(uuid,numeric,numeric,timestamp with time zone,boolean)','4f422c267d61c0afb2c11011a390b720','8d2541501195cd9a3fcc025b8045f14a',$anchor$ select * into strict current_item from public.inventory_items where id=p_id for update;$anchor$,$replacement$ select * into strict current_item from public.inventory_items where id=p_id for update;
 -- Re-read committed authority after the item-lock wait; do not reuse a pre-wait helper result.
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('student','lead','admin_lead','admin','mentor')) then
  raise exception 'You do not have permission to change inventory' using errcode='42501';
 end if;$replacement$),
  ('public.inventory_action(text,jsonb)','1ddface6796b047686122bea43b19db5','0a5eec387ddbd4bfe136695765e039cc',$anchor$ select * into strict i from public.inventory_items where id=iid for update;$anchor$,$replacement$ select * into strict i from public.inventory_items where id=iid for update;
 -- Re-read committed authority after the item-lock wait; do not reuse a pre-wait helper result.
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('student','lead','admin_lead','admin','mentor')) then
  raise exception 'You do not have permission to change inventory' using errcode='42501';
 end if;$replacement$),
  ('public.verify_balance_location(uuid,jsonb)','2856227d07b0b7d1a944d233f7afda98','4805c944675d74537c1e985e7e180a7f',$anchor$ perform 1 from public.inventory_items where location_id=p_location or id in(select inventory_item_id from public.inventory_balances where location_id=p_location and quantity>0) order by id for update;$anchor$,$replacement$ perform 1 from public.inventory_items where location_id=p_location or id in(select inventory_item_id from public.inventory_balances where location_id=p_location and quantity>0) order by id for update;
 -- Re-read committed authority after the item-lock wait; do not reuse a pre-wait helper result.
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('student','lead','admin_lead','admin','mentor')) then
  raise exception 'You do not have permission to change inventory' using errcode='42501';
 end if;$replacement$)
 ) as replacements(signature,before_md5,after_md5,anchor,replacement) loop
  definition:=pg_get_functiondef(entry.signature::regprocedure);
  if md5(definition)<>entry.before_md5 then raise exception 'Inventory authority full definition drift in %',entry.signature;end if;
  if (select pg_get_userbyid(proowner) from pg_proc where oid=entry.signature::regprocedure)<>'postgres'
   or (select proacl::text from pg_proc where oid=entry.signature::regprocedure) is distinct from '{postgres=X/postgres,authenticated=X/postgres}' then
   raise exception 'Inventory authority ownership or ACL drift in %',entry.signature;
  end if;
  execute replace(definition,entry.anchor,entry.replacement);
  if md5(pg_get_functiondef(entry.signature::regprocedure))<>entry.after_md5 then raise exception 'Inventory authority output mismatch in %',entry.signature;end if;
 end loop;
end
$migration$;
commit;
