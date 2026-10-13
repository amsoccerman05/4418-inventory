-- REVIEW ONLY: additive Inventory / Finance integration. Never applies or seeds itself.
-- Requires Inventory 004 and the shared Finance v1 + current position-based approvals.
begin;
do $$ begin
 if to_regprocedure('public.finance_mutate(text,jsonb)') is null
 or to_regprocedure('finance_private.revision_approved(uuid,integer)') is null
 or to_regprocedure('private.balance_sync(uuid)') is null
 or to_regprocedure('public.inventory_setup_features()') is null then
  raise exception 'Install and verify Finance, Inventory logistics and item setup prerequisites first';
 end if;
end $$;
create schema inventory_purchasing;
revoke all on schema inventory_purchasing from public,anon,authenticated;
grant usage on schema inventory_purchasing to authenticated;
create table inventory_purchasing.settings (
 item_id uuid primary key references public.inventory_items(id),
 supplier text not null check(length(trim(supplier)) between 1 and 150),
 product_url text not null default '' check(length(product_url)<=2000 and (product_url='' or product_url ~ '^https?://[^[:space:]]+$')),
 purchase_unit text not null check(length(trim(purchase_unit)) between 1 and 50),
 stock_unit text not null check(length(trim(stock_unit)) between 1 and 50),
 units_per_pack numeric not null check(units_per_pack>0 and units_per_pack<=1000000 and units_per_pack=round(units_per_pack,6)),
 pack_cost numeric(14,2) check(pack_cost>0 and pack_cost<=999999999999.99),
 version integer not null default 1,
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create table inventory_purchasing.requests (
 id uuid primary key, item_id uuid not null references public.inventory_items(id),
 requester_id uuid not null references public.profiles(id),
 area_id uuid not null references public.areas(id), item_name text not null,
 supplier text not null, product_url text not null, purchase_unit text not null, stock_unit text not null,
 packs integer not null check(packs>0 and packs<=1000000),
 units_per_pack numeric not null check(units_per_pack>0 and units_per_pack<=1000000 and units_per_pack=round(units_per_pack,6)),
 pack_cost numeric(14,2),
 quantity numeric generated always as (packs*units_per_pack) stored check(quantity<=100000000),
 received numeric not null default 0 check(received>=0 and received<=packs*units_per_pack),
 state text not null default 'requested' check(state in ('requested','po_linked','ordered','partial','received','cancelled','closed_short')),
 note text not null default '' check(length(note)<=2000),
 po_id uuid unique references public.finance_purchase_orders(id),
 po_revision integer, order_reference text not null default '',
 ordered_by uuid references public.profiles(id), ordered_at timestamptz,
 closed_reason text not null default '', version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index inventory_one_open_restock on inventory_purchasing.requests(item_id)
 where state in ('requested','po_linked','ordered','partial');
create index inventory_restock_requester on inventory_purchasing.requests(requester_id);
create table inventory_purchasing.receipts (
 id uuid primary key, request_id uuid not null references inventory_purchasing.requests(id),
 quantity numeric not null check(quantity>0 and quantity<=100000000 and quantity=round(quantity,6)),
 location_id uuid not null references public.locations(id),
 delivery_reference text not null check(length(trim(delivery_reference)) between 1 and 150),
 note text not null default '' check(length(note)<=2000),
 actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(request_id,delivery_reference)
);
create table inventory_purchasing.history (
 id bigint generated always as identity primary key,
 request_id uuid references inventory_purchasing.requests(id), item_id uuid references public.inventory_items(id),
 action text not null, actor_id uuid not null references public.profiles(id),
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index inventory_restock_history_request on inventory_purchasing.history(request_id,id);
-- No direct reads or writes. The context RPC has a deliberately narrow projection;
-- no Finance amount, sheet, purpose, requester, reference or ID bypasses Finance visibility.
alter table inventory_purchasing.settings enable row level security;
alter table inventory_purchasing.requests enable row level security;
alter table inventory_purchasing.receipts enable row level security;
alter table inventory_purchasing.history enable row level security;
revoke all on all tables in schema inventory_purchasing from public,anon,authenticated;
revoke all on all sequences in schema inventory_purchasing from public,anon,authenticated;

create function inventory_purchasing.context(p_item_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or private.current_role() is null then raise exception 'Active team account required' using errcode='42501';end if;
 return jsonb_build_object('available',true,'can_request',private.can_count(),
 'settings',(select coalesce(jsonb_agg(to_jsonb(s)-array['updated_by']),'[]') from inventory_purchasing.settings s where p_item_id is null or s.item_id=p_item_id),
 'requests',(select coalesce(jsonb_agg(
   (to_jsonb(r)-array['po_id','po_revision','order_reference','ordered_by','requester_id']) || jsonb_build_object(
    'can_manage',private.can_count() and (r.requester_id=auth.uid() or coalesce(private.can_edit(i.area_id),false)),
    'can_record_order',private.can_count() and coalesce(finance_private.visible(r.po_id),false) and (finance_private.cap('school_submitter') or finance_private.role() in ('admin','mentor')),
    'can_receive',private.can_count() and r.state in ('ordered','partial'),
    'po',case when finance_private.visible(r.po_id) then (select jsonb_build_object('id',p.id,'number',p.po_number,'status',p.status,'revision',p.revision,'amount',p.amount,'can_link',p.requester_id=auth.uid() or finance_private.admin()) from public.finance_purchase_orders p where p.id=r.po_id) else null end
   ) order by r.created_at desc),'[]') from inventory_purchasing.requests r join public.inventory_items i on i.id=r.item_id where p_item_id is null or r.item_id=p_item_id),
 'receipts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'request_id',c.request_id,'quantity',c.quantity,'location_id',c.location_id,'created_at',c.created_at) order by c.created_at desc),'[]') from inventory_purchasing.receipts c join inventory_purchasing.requests r on r.id=c.request_id where p_item_id is null or r.item_id=p_item_id));
end $$;

create function inventory_purchasing.act(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); i public.inventory_items; s inventory_purchasing.settings; r inventory_purchasing.requests;
 po public.finance_purchase_orders; receipt inventory_purchasing.receipts;
 iid uuid; rid uuid; pid uuid; receipt_id uuid; qty numeric; have numeric; packs integer;
 dst public.locations; ref text; v_note text:=trim(coalesce(p->>'note','')); result jsonb;
begin
 if actor is null or not private.can_count() then raise exception 'Inventory write access required' using errcode='42501';end if;
 if length(v_note)>2000 then raise exception 'Notes must be at most 2000 characters';end if;
 -- Match Finance's lock ordering, including create. Do not hold an item/request lock
 -- while waiting for Finance's budget lock. All mutations below share this order.
 perform pg_advisory_xact_lock(4418,20);
 if p_action='configure' then
  select * into i from public.inventory_items where id=(p->>'item_id')::uuid for update;
  if not found or not coalesce(private.can_edit(i.area_id),false) then raise exception 'Assigned lead, admin or mentor required' using errcode='42501';end if;
  select * into s from inventory_purchasing.settings where item_id=i.id;
  if coalesce(s.version,0) is distinct from (p->>'version')::integer then raise exception 'Purchasing setup changed. Refresh before saving.' using errcode='40001';end if;
  insert into inventory_purchasing.settings(item_id,supplier,product_url,purchase_unit,stock_unit,units_per_pack,pack_cost,updated_by)
  values(i.id,trim(p->>'supplier'),trim(coalesce(p->>'product_url','')),trim(p->>'purchase_unit'),i.unit,(p->>'units_per_pack')::numeric,nullif(p->>'pack_cost','')::numeric,actor)
  on conflict(item_id) do update set supplier=excluded.supplier,product_url=excluded.product_url,purchase_unit=excluded.purchase_unit,stock_unit=excluded.stock_unit,units_per_pack=excluded.units_per_pack,pack_cost=excluded.pack_cost,updated_by=actor,updated_at=clock_timestamp(),version=inventory_purchasing.settings.version+1;
  insert into inventory_purchasing.history(item_id,action,actor_id) values(i.id,'configured',actor);
  return inventory_purchasing.context(i.id);
 end if;
 if p_action='request' then
  rid:=(p->>'id')::uuid; packs:=(p->>'packs')::integer;
  if rid is null or packs is null or packs<=0 or packs>1000000 then raise exception 'Choose whole purchase packs between 1 and 1000000';end if;
  select * into i from public.inventory_items where id=(p->>'item_id')::uuid for update;
  if not found or not private.can_count() then raise exception 'Inventory item unavailable' using errcode='42501';end if;
  select * into r from inventory_purchasing.requests where id=rid;
  if found then
   if r.requester_id<>actor or r.item_id<>i.id or r.packs<>packs or r.note<>v_note then raise exception 'Request retry does not match the original';end if;
   return inventory_purchasing.context(i.id);
  end if;
  if i.restock_policy='do_not_restock' then raise exception 'This item is marked do not restock. An assigned lead must change its stock policy before creating a request';end if;
  select * into s from inventory_purchasing.settings where item_id=i.id;
  if not found or s.stock_unit is distinct from i.unit then raise exception 'Set up and verify supplier and purchase-unit conversion first';end if;
  if s.version is distinct from (p->>'settings_version')::integer then raise exception 'Purchasing setup changed. Refresh before requesting.' using errcode='40001';end if;
  if exists(select 1 from inventory_purchasing.requests where item_id=i.id and state in ('requested','po_linked','ordered','partial')) then raise exception 'This item already has an open restock request';end if;
  if packs*s.units_per_pack>100000000 or i.quantity+packs*s.units_per_pack>100000000 or i.quantity<>round(i.quantity,6) then raise exception 'Purchasing supports totals up to 100000000 stock units and 6 decimal places; reduce the request or review existing stock precision';end if;
  insert into inventory_purchasing.requests(id,item_id,requester_id,area_id,item_name,supplier,product_url,purchase_unit,stock_unit,packs,units_per_pack,pack_cost,note)
  values(rid,i.id,actor,i.area_id,i.name,s.supplier,s.product_url,s.purchase_unit,s.stock_unit,packs,s.units_per_pack,s.pack_cost,v_note);
  insert into inventory_purchasing.history(request_id,item_id,action,actor_id) values(rid,i.id,'requested',actor);
  return inventory_purchasing.context(i.id);
 end if;
 rid:=(p->>'request_id')::uuid;
 select * into r from inventory_purchasing.requests where id=rid for update;
 if not found then raise exception 'Restock request unavailable';end if;
 select * into i from public.inventory_items where id=r.item_id for update;
 if not private.can_count() then raise exception 'Inventory write access required' using errcode='42501';end if;
 -- Idempotent receipt replay must be recognized even after the final receipt closed
 -- the request. The payload and actor must match; retries never add stock twice.
 if p_action='receive' then
  receipt_id:=(p->>'id')::uuid;qty:=(p->>'quantity')::numeric;
  -- Match JavaScript String.trim() for direct RPC callers too; SQL trim() alone
  -- ignores tabs/newlines and Unicode spaces, allowing duplicate delivery aliases.
  ref:=lower(btrim(coalesce(p->>'delivery_reference',''), E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)));
  select * into receipt from inventory_purchasing.receipts where id=receipt_id;
  if found then
   if receipt.request_id<>r.id or receipt.quantity is distinct from qty or receipt.location_id is distinct from (p->>'location_id')::uuid or receipt.delivery_reference<>ref or receipt.actor_id<>actor or receipt.note<>v_note then raise exception 'Receipt retry does not match the original';end if;
   return inventory_purchasing.context(i.id);
  end if;
 end if;
 if r.version is distinct from (p->>'version')::integer then raise exception 'Restock request changed. Refresh before acting.' using errcode='40001';end if;
 if p_action in ('create_po','link_po','cancel','close_short') and not (r.requester_id=actor or coalesce(private.can_edit(i.area_id),false)) then raise exception 'Requester or assigned inventory lead required' using errcode='42501';end if;
 if p_action in ('create_po','link_po') then
  if r.state<>'requested' or r.po_id is not null then raise exception 'A purchase order is already linked or this request is closed';end if;
  if i.area_id<>r.area_id or i.unit<>r.stock_unit then raise exception 'Item area or unit changed. Cancel this request and create a new one';end if;
  if p_action='create_po' then
   if i.order_status='Ordered' then raise exception 'Already marked Ordered in legacy inventory; link the existing PO or review the legacy order status before creating another draft';end if;
   -- Existing Finance RPC enforces creator authority, schema and auditing.
   -- Creates a draft only: no approvals, submission, purchase, payment or email.
   pid:=public.finance_mutate('create',jsonb_build_object('area_id',r.area_id,'sheet_url',p->>'sheet_url','vendor',r.supplier,'amount',p->>'amount','purpose','Restock '||r.item_name||': '||r.packs||' '||r.purchase_unit||' ('||r.quantity||' '||r.stock_unit||')','notes','Inventory request '||r.id||'. '||r.note,'needed_by',p->>'needed_by'));
  else pid:=(p->>'po_id')::uuid;end if;
  if not coalesce(finance_private.visible(pid),false) then raise exception 'Purchase order unavailable' using errcode='42501';end if;
  select * into po from public.finance_purchase_orders where id=pid for share;
  if not found or not coalesce(finance_private.visible(pid),false) or not (po.requester_id=actor or finance_private.admin()) then raise exception 'PO requester or Finance administrator required' using errcode='42501';end if;
  if po.status='cancelled' or po.area_id<>r.area_id or lower(trim(po.vendor))<>lower(trim(r.supplier)) then raise exception 'Choose an active PO with the same supplier and team area';end if;
  if r.pack_cost is not null and po.amount<r.packs*r.pack_cost then raise exception 'PO total is below the estimated restock amount';end if;
  if exists(select 1 from inventory_purchasing.requests where po_id=pid) then raise exception 'This PO is already allocated to another inventory request';end if;
  update inventory_purchasing.requests set po_id=pid,state='po_linked' where id=rid;
 elsif p_action='record_order' then
  if r.state<>'po_linked' then raise exception 'Link a PO before recording an order';end if;
  if not coalesce(finance_private.visible(r.po_id),false) or not (finance_private.cap('school_submitter') or finance_private.role() in ('admin','mentor')) then raise exception 'School submitter, admin or mentor with PO access required' using errcode='42501';end if;
  select * into po from public.finance_purchase_orders where id=r.po_id for share;
  if not coalesce(finance_private.visible(r.po_id),false) or not (finance_private.cap('school_submitter') or finance_private.role() in ('admin','mentor')) then raise exception 'School submitter, admin or mentor with PO access required' using errcode='42501';end if;
  if po.status<>'submitted_to_school' or not finance_private.revision_approved(po.id,po.revision) then raise exception 'Both current-revision approvals and school submission are required';end if;
  if po.area_id<>r.area_id or lower(trim(po.vendor))<>lower(trim(r.supplier)) or (r.pack_cost is not null and po.amount<r.packs*r.pack_cost) then raise exception 'PO changed and no longer matches this request';end if;
  ref:=trim(coalesce(p->>'reference',''));
  if length(ref) not between 1 and 150 then raise exception 'Enter the actual supplier order reference (1 to 150 characters)';end if;
  update inventory_purchasing.requests set state='ordered',po_revision=po.revision,order_reference=ref,ordered_by=actor,ordered_at=clock_timestamp() where id=rid;
 elsif p_action='receive' then
  if r.state not in ('ordered','partial') then raise exception 'Only an explicitly recorded order can be received';end if;
  if receipt_id is null or qty is null or qty<=0 or qty>r.quantity-r.received or qty>='Infinity'::numeric then raise exception 'Receive a positive quantity no greater than the remaining stock units';end if;
  if qty<>round(qty,6) or i.quantity<>round(i.quantity,6) or i.quantity+qty>100000000 then raise exception 'Purchasing supports totals up to 100000000 stock units and 6 decimal places';end if;
  if length(ref) not between 1 and 150 then raise exception 'Delivery reference is required (1 to 150 characters)';end if;
  if exists(select 1 from inventory_purchasing.receipts where request_id=rid and delivery_reference=ref) then raise exception 'This delivery reference has already been received';end if;
  select * into po from public.finance_purchase_orders where id=r.po_id for share;
  if po.status<>'submitted_to_school' or po.revision<>r.po_revision or not finance_private.revision_approved(po.id,po.revision) then raise exception 'The linked order no longer has both current approvals and school submission';end if;
  if i.unit<>r.stock_unit then raise exception 'Inventory stock unit changed. Restore the original unit before receiving';end if;
  select * into dst from public.locations where id=(p->>'location_id')::uuid and active and trip_id is null for share;
  if not found then raise exception 'Choose an active non-travel receiving location';end if;
  if not private.can_count() then raise exception 'Inventory write access required' using errcode='42501';end if;
  select coalesce(sum(quantity),0) into have from public.inventory_balances where inventory_item_id=i.id and location_id=dst.id;
  if have<>round(have,6) or have+qty>100000000 then raise exception 'Receiving location exceeds supported stock precision or range';end if;
  perform private.balance_set(i.id,dst.id,have+qty);
  perform private.balance_sync(i.id);
  insert into inventory_purchasing.receipts(id,request_id,quantity,location_id,delivery_reference,note,actor_id) values(receipt_id,rid,qty,dst.id,ref,v_note,actor);
  -- Existing adjustment movement type preserves old clients. Receipt identity gives
  -- exact provenance without exposing PO IDs or financial details to stock counters.
  insert into public.inventory_movements(inventory_item_id,item_name,quantity,to_location_id,movement_type,user_id,note)
  values(i.id,i.name,qty,dst.id,'adjustment',actor,'Restock receipt '||receipt_id||' for request '||rid);
  update inventory_purchasing.requests set received=received+qty,state=case when received+qty=quantity then 'received' else 'partial' end where id=rid;
 elsif p_action='cancel' then
  if r.state not in ('requested','po_linked') then raise exception 'An ordered request cannot be cancelled; close the unreceived remainder explicitly';end if;
  if r.po_id is not null and not exists(select 1 from public.finance_purchase_orders where id=r.po_id and status='cancelled') then raise exception 'Cancel the linked PO in Finance before cancelling this request';end if;
  if v_note='' then raise exception 'Cancellation reason is required';end if;
  update inventory_purchasing.requests set state='cancelled',closed_reason=v_note where id=rid;
 elsif p_action='close_short' then
  if not coalesce(private.can_edit(i.area_id),false) then raise exception 'Assigned lead, admin or mentor required' using errcode='42501';end if;
  if r.state not in ('ordered','partial') or v_note='' then raise exception 'Explain why the remaining order will not arrive';end if;
  update inventory_purchasing.requests set state='closed_short',closed_reason=v_note where id=rid;
 else raise exception 'Unknown purchasing action';end if;
 update inventory_purchasing.requests set version=version+1,updated_at=clock_timestamp() where id=rid;
 insert into inventory_purchasing.history(request_id,item_id,action,actor_id,details) values(rid,i.id,p_action,actor,jsonb_build_object('note',v_note,'receipt_id',receipt_id,'quantity',qty));
 return inventory_purchasing.context(i.id);
end $$;
create function public.inventory_purchasing_context(p_item_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$select inventory_purchasing.context(p_item_id)$$;
create function public.inventory_purchasing_action(p_action text,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$select inventory_purchasing.act(p_action,p_data)$$;
revoke all on all functions in schema inventory_purchasing from public,anon,authenticated;
grant execute on function inventory_purchasing.context(uuid),inventory_purchasing.act(text,jsonb) to authenticated;
revoke all on function public.inventory_purchasing_context(uuid),public.inventory_purchasing_action(text,jsonb) from public,anon;
grant execute on function public.inventory_purchasing_context(uuid),public.inventory_purchasing_action(text,jsonb) to authenticated;
comment on function public.inventory_purchasing_action(text,jsonb) is 'Explicit restock requests, Finance draft/link and stock receiving. No approval, payment, external order or notification action.';
commit;
