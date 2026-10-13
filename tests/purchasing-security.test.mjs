import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const db=new PGlite();
const users=Object.fromEntries(['mentor','student','counter','finance','coach','readonly','otherlead'].map((name,n)=>[name,`00000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`]));
const area='44180000-0000-4000-8000-000000000001',otherArea='44180000-0000-4000-8000-000000000002';
const home=randomUUID(),project=randomUUID(),travel=randomUUID();
let migration;
const asUser=(who,fn)=>db.transaction(async tx=>{await tx.exec(`set local role ${who==='anon'?'anon':'authenticated'}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[users[who]??'']);return fn(tx);});
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const act=async(who,action,p)=>(await asUser(who,tx=>tx.query('select public.inventory_purchasing_action($1,$2) result',[action,JSON.stringify(p)]))).rows[0].result;
const context=async(who,item)=>(await asUser(who,tx=>tx.query('select public.inventory_purchasing_context($1) result',[item??null]))).rows[0].result;
const raw=async id=>scalar('select * from inventory_purchasing.requests where id=$1',[id]);
const finance=async(who,action,id,p={})=>{const po=await scalar('select version from public.finance_purchase_orders where id=$1',[id]);return asUser(who,tx=>tx.query('select public.finance_mutate($1,$2)',[action,JSON.stringify({id,version:po.version,...p})]));};
const makeItem=async(unit='each')=>{const id=randomUUID();await asUser('mentor',tx=>tx.query("insert into public.inventory_items(id,name,area_id,category,quantity,unit,location_id) values($1,'Test restock component',$2,'Parts',3,$3,$4)",[id,area,unit,home]));return id;};
const setup=async(item,values={})=>act('mentor','configure',{item_id:item,version:0,supplier:'Test Supplier',product_url:'',purchase_unit:'box',units_per_pack:10,pack_cost:25,...values});
const request=async(item,who='student',packs=2,id=randomUUID())=>{await act(who,'request',{id,item_id:item,packs,settings_version:1,note:'Local test only'});return id;};
const createPO=async(id,who='student',data={})=>{const r=await raw(id);await act(who,'create_po',{request_id:id,version:r.version,sheet_url:'https://docs.google.com/spreadsheets/d/local-test-only',amount:60,...data});return (await raw(id)).po_id;};
const finishApprovals=async(pid)=>{await finance('student','submit',pid);await finance('finance','approve',pid,{slot:'finance_approver'});await finance('coach','approve',pid,{slot:'po_approver'});await finance('mentor','school_submit',pid);};
const recordOrder=async(id)=>{const r=await raw(id);return act('mentor','record_order',{request_id:id,version:r.version,reference:'TEST-ORDER'});};
const receipt=async(id,qty=5,reference=randomUUID(),receiptId=randomUUID(),extra={})=>{const r=await raw(id);return act('counter','receive',{id:receiptId,request_id:id,version:r.version,quantity:qty,location_id:home,delivery_reference:reference,note:'Local fixture',...extra});};
before(async()=>{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;");
 for(const [name,id]of Object.entries(users))await db.query('insert into auth.users(id,email) values($1,$2)',[id,name+'@example.test']);
 for(const name of ['001_initial_schema.sql','002_rls_policies.sql','003_operations_and_seed.sql','004_balances_travel_media.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 for(const [name,id]of Object.entries(users))await db.query('update public.profiles set role=$1,primary_area_id=$2 where id=$3',[['mentor','coach'].includes(name)?'mentor':['finance','otherlead'].includes(name)?'lead':name==='readonly'?'readonly':'student',name==='otherlead'?otherArea:area,id]);
 await asUser('mentor',tx=>tx.query("insert into public.locations(id,name,location_type) values($1,'Home','Drawer'),($2,'Project','Storage')",[home,project]));
 await db.exec("create table public.team_attendance_members(student_id uuid,member_status text);create table public.team_positions(key text primary key,name text,active boolean default true);create table public.team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);insert into public.team_positions(key,name) values('finance_lead','Finance'),('lead_coach_1','Coach'),('power_lead','Power');create function public.team_has_position(key text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.team_member_positions m join public.profiles p on p.id=m.user_id and p.active join public.team_positions t on t.key=m.position_key and t.active where m.user_id=auth.uid() and m.revoked_at is null and m.position_key=$1)$$;create function public.team_has_any_position(keys text[]) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from unnest(keys) k where public.team_has_position(k))$$;");
 await db.query('insert into public.team_member_positions(user_id,position_key) values($1,\'finance_lead\'),($2,\'lead_coach_1\')',[users.finance,users.coach]);
 await db.exec(await readFile(new URL('./fixtures/team-live-authority.sql',import.meta.url),'utf8'));
 for(const name of ['finance-v1.sql','finance-budget.sql','finance-live-authority.sql','finance-notifications.sql','finance-live-notifications.sql'])await db.exec(await readFile(new URL('./fixtures/'+name,import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261012232840_inventory_setup_location_labels.sql',import.meta.url),'utf8'));
 const name=(await readdir(new URL('../supabase/migrations/',import.meta.url))).find(f=>f.endsWith('_inventory_restock_finance_receiving.sql'));
 migration=await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');await db.exec(migration);
});
after(()=>db.close());
test('new private tables and invoker endpoints have no anonymous/direct write bypass',async()=>{
 const item=await makeItem();
 await assert.rejects(()=>context('anon',item),/permission/);
 await assert.rejects(()=>act('readonly','request',{id:randomUUID(),item_id:item,packs:1}),/write access/);
 for(const table of ['settings','requests','receipts','history']){
  for(const who of ['student','mentor'])await assert.rejects(()=>asUser(who,tx=>tx.query(`select * from inventory_purchasing.${table}`)),/permission/);
  assert.equal((await scalar("select relrowsecurity from pg_class where oid=$1::regclass",['inventory_purchasing.'+table])).relrowsecurity,true);
 }
 const functions=(await db.query("select p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='inventory_purchasing'")).rows;
 assert.ok(functions.every(f=>f.prosecdef&&f.proconfig.includes('search_path=""')));
 await assert.rejects(()=>asUser('student',tx=>tx.query("insert into inventory_purchasing.requests(id,item_id) values($1,$2)",[randomUUID(),item])),/permission/);
});
test('zero stock thresholds and unknown supplier costs are not invented',async()=>{
 const item=await makeItem();assert.equal((await context('student',item)).settings.length,0);
 await assert.rejects(()=>request(item),/Set up/);
 await assert.rejects(()=>setup(item,{units_per_pack:0}),/check constraint/);
 await assert.rejects(()=>act('otherlead','configure',{item_id:item,version:0,supplier:'Bad',purchase_unit:'each',units_per_pack:1}),/Assigned lead/);
 await setup(item,{pack_cost:null});const c=await context('student',item);assert.equal(c.settings[0].pack_cost,null);
 assert.equal((await scalar('select target_quantity::float from public.inventory_items where id=$1',[item])).target_quantity,0);
 const id=await request(item);await assert.rejects(()=>createPO(id,'student',{amount:null}),/not.null|violates/);
 assert.equal((await raw(id)).po_id,null);
});
test('requests have snapshot conversions, stale detection, exact replay and one-open-item protection',async()=>{
 const item=await makeItem();await setup(item);const id=await request(item);
 await act('student','request',{id,item_id:item,packs:2,settings_version:1,note:'Local test only'});
 await assert.rejects(()=>act('student','request',{id,item_id:item,packs:3,settings_version:1,note:'Local test only'}),/retry does not match/);
 await assert.rejects(()=>request(item,'counter'),/already has an open/);
 await setup(item,{version:1,units_per_pack:12,pack_cost:30});
 assert.equal(Number((await raw(id)).quantity),20);assert.equal(Number((await raw(id)).units_per_pack),10);
 await assert.rejects(()=>act('student','cancel',{request_id:id,version:999,note:'Cancel'}),/changed/);
 await assert.rejects(()=>act('counter','cancel',{request_id:id,version:1,note:'Cancel'}),/Requester/);
 await act('student','cancel',{request_id:id,version:1,note:'No longer needed'});
 await assert.rejects(()=>request(item),/setup changed/i);
});
test('draft creation is atomic, Finance-visible only, duplicate-proof and does not enqueue email',async()=>{
 const item=await makeItem();await setup(item);const id=await request(item);
 const before=await scalar('select count(*)::int n from public.team_notifications');
 await assert.rejects(()=>createPO(id,'student',{amount:1}),/below the estimated/);
 assert.equal((await scalar("select count(*)::int n from public.finance_purchase_orders where purpose like '%Test restock component%'")).n,0);
 const pid=await createPO(id);
 const savedCount=(await scalar('select count(*)::int n from public.finance_purchase_orders')).n;
 await assert.rejects(()=>act('student','create_po',{request_id:id,version:1,sheet_url:'https://docs.google.com/spreadsheets/d/local-test-only',amount:60}),/changed/);
 assert.equal((await scalar('select count(*)::int n from public.finance_purchase_orders')).n,savedCount);
 assert.equal((await scalar('select status from public.finance_purchase_orders where id=$1',[pid])).status,'draft');
 assert.deepEqual(await scalar('select count(*)::int n from public.team_notifications'),before);
 await assert.rejects(()=>createPO(id),/already linked/);
 const allowed=(await context('student',item)).requests[0];assert.equal(allowed.po.id,pid);
 const restricted=(await context('counter',item)).requests[0];assert.equal(restricted.po,null);assert.ok(!('po_id' in restricted));assert.ok(!('requester_id' in restricted));assert.ok(!('order_reference' in restricted));
 assert.ok(!JSON.stringify(restricted).includes('sheet_url'));assert.ok(!JSON.stringify(restricted).includes('purpose'));assert.ok(!JSON.stringify(restricted).includes('amount'));
 assert.equal(restricted.pack_cost,25); // Team-visible catalog estimate, NOT this PO's total of 60.
 const receivedProjection=(await context('counter',item)).receipts;assert.ok(receivedProjection.every(c=>!('note' in c)&&!('delivery_reference' in c)));
 await assert.rejects(()=>act('counter','record_order',{request_id:id,version:2,reference:'X'}),/submitter/);
 await assert.rejects(()=>recordOrder(id),/Both current/);
});
test('two distinct current-revision approvals and school submission remain mandatory',async()=>{
 const item=await makeItem();await setup(item);const id=await request(item),pid=await createPO(id);
 await finance('student','submit',pid);
 await finance('finance','approve',pid,{slot:'finance_approver'});
 await assert.rejects(()=>recordOrder(id),/Both current/);
 // Mentor with one emergency override still cannot fill both slots.
 await assert.rejects(()=>finance('finance','approve',pid,{slot:'po_approver',override_reason:'Try bypass'}),/Configured|Only mentors/);
 await finance('coach','approve',pid,{slot:'po_approver'});
 await assert.rejects(()=>recordOrder(id),/school submission/);
 await finance('mentor','school_submit',pid);await recordOrder(id);
 assert.equal((await raw(id)).state,'ordered');
 assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[item])).quantity,3);
});
test('receipts atomically add stock-unit counts and partial/final retries never double count',async()=>{
 const item=await makeItem('ft');await setup(item,{units_per_pack:12.5,pack_cost:20});const id=await request(item),pid=await createPO(id);
 await finishApprovals(pid);await recordOrder(id);
 const countBefore=(await scalar('select count(*)::int n from public.team_notifications')).n;
 const key=randomUUID(),version=(await raw(id)).version;
 const payload={id:key,request_id:id,version,quantity:7.5,location_id:project,delivery_reference:' Delivery-A ',note:'Local fixture'};
 await act('counter','receive',payload);await act('counter','receive',payload);
 assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[item])).quantity,10.5);
 assert.equal((await scalar('select quantity::float from public.inventory_balances where inventory_item_id=$1 and location_id=$2',[item,home])).quantity,3);
 assert.equal((await scalar('select quantity::float from public.inventory_balances where inventory_item_id=$1 and location_id=$2',[item,project])).quantity,7.5);
 assert.equal((await raw(id)).state,'partial');
 assert.equal((await context('counter',item)).requests[0].po,null);
 assert.equal((await context('counter',item)).requests[0].can_receive,true);
 await assert.rejects(()=>act('counter','receive',{...payload,quantity:8}),/retry does not match/);
 await assert.rejects(()=>receipt(id,1,'delivery-a'),/already been received/);
 await assert.rejects(()=>receipt(id,18),/no greater/);
 await assert.rejects(()=>receipt(id,0),/positive/);
 await assert.rejects(()=>receipt(id,1,'new',randomUUID(),{location_id:randomUUID()}),/location/);
 const last=randomUUID(),fresh=(await raw(id)).version;
 const final={id:last,request_id:id,version:fresh,quantity:17.5,location_id:home,delivery_reference:'Delivery-B',note:'Local fixture'};
 await act('counter','receive',final);await act('counter','receive',final);
 assert.equal((await raw(id)).state,'received');
 assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[item])).quantity,28);
 assert.equal((await scalar('select count(*)::int n from inventory_purchasing.receipts where request_id=$1',[id])).n,2);
 assert.equal((await scalar('select count(*)::int n from public.team_notifications')).n,countBefore);
 await assert.rejects(()=>receipt(id,1),/Only an explicitly/);
});
test('receiving blocks changed item units and inactive callers without partial writes',async()=>{
 const item=await makeItem();await setup(item);const id=await request(item),pid=await createPO(id);await finishApprovals(pid);await recordOrder(id);
 await asUser('mentor',tx=>tx.query("update public.inventory_items set unit='box' where id=$1",[item]));
 await assert.rejects(()=>receipt(id),/stock unit changed/);
 assert.equal(Number((await raw(id)).received),0);assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[item])).quantity,3);
 await asUser('mentor',tx=>tx.query("update public.inventory_items set unit='each' where id=$1",[item]));
 await db.query('update public.profiles set active=false where id=$1',[users.counter]);await assert.rejects(()=>receipt(id),/write access/);await assert.rejects(()=>context('counter',item),/Active/);await db.query('update public.profiles set active=true where id=$1',[users.counter]);
});
test('close-short keeps received stock, cancels remaining demand and permits a fresh request',async()=>{
 const item=await makeItem();await setup(item);const id=await request(item),pid=await createPO(id);await finishApprovals(pid);await recordOrder(id);await receipt(id,5);
 let r=await raw(id);await assert.rejects(()=>act('student','close_short',{request_id:id,version:r.version,note:'Supplier could not fill remainder'}),/Assigned lead/);
 await act('mentor','close_short',{request_id:id,version:r.version,note:'Supplier could not fill remainder'});
 assert.equal((await raw(id)).state,'closed_short');assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[item])).quantity,8);
 await request(item);await assert.rejects(()=>receipt(id,1),/Only an explicitly/);
});
test('linking checks Finance ownership, supplier, area and exclusive allocation',async()=>{
 const first=await makeItem();await setup(first);const r1=await request(first),pid=await createPO(r1);
 const second=await makeItem();await setup(second);const r2=await request(second,'counter');
 await assert.rejects(()=>act('counter','link_po',{request_id:r2,version:1,po_id:pid}),/unavailable/);
 await assert.rejects(()=>act('mentor','link_po',{request_id:r2,version:1,po_id:pid}),/already allocated/);
 await assert.rejects(()=>act('mentor','cancel',{request_id:r1,version:2,note:'Change plans'}),/Cancel the linked PO/);
 await finance('student','cancel',pid,{reason:'Local test cancellation'});
 await act('mentor','cancel',{request_id:r1,version:2,note:'PO cancelled'});assert.equal((await raw(r1)).state,'cancelled');
});
test('a mentor override cannot approve both slots and revision edits invalidate readiness',async()=>{
 const item=await makeItem();await setup(item);const id=await request(item),pid=await createPO(id);
 await finance('student','submit',pid);
 await finance('coach','approve',pid,{slot:'finance_approver',override_reason:'Local emergency role test'});
 await assert.rejects(()=>finance('coach','approve',pid,{slot:'po_approver'}),/Two distinct people/);
 await finance('mentor','approve',pid,{slot:'po_approver',override_reason:'Independent second approval'});
 await finance('student','edit',pid,{area_id:area,sheet_url:'https://docs.google.com/spreadsheets/d/local-test-only',vendor:'Test Supplier',amount:60,purpose:'Edited after approval'});
 await assert.rejects(()=>recordOrder(id),/Both current/);
 await finance('student','submit',pid);
 assert.equal((await scalar('select revision from public.finance_purchase_orders where id=$1',[pid])).revision,2);
 await assert.rejects(()=>finance('mentor','school_submit',pid),/Both current/);
 await assert.rejects(()=>recordOrder(id),/Both current/);
});
test('mismatched and cancelled existing POs cannot attach; invalid receipt leaves no mutation',async()=>{
 const item=await makeItem();await setup(item);const id=await request(item);
 const existing=async(p)=>{const data={area_id:area,sheet_url:'https://docs.google.com/spreadsheets/d/local-test-only',vendor:'Different Supplier',amount:60,purpose:'Local attachment test',...p};return (await asUser('student',tx=>tx.query("select public.finance_mutate('create',$1) id",[JSON.stringify(data)]))).rows[0].id;};
 const wrongSupplier=await existing({});await assert.rejects(()=>act('student','link_po',{request_id:id,version:1,po_id:wrongSupplier}),/same supplier/);
 const wrongArea=await existing({vendor:'Test Supplier',area_id:otherArea});await assert.rejects(()=>act('student','link_po',{request_id:id,version:1,po_id:wrongArea}),/same supplier/);
 const cancelled=await existing({vendor:'Test Supplier'});await finance('student','cancel',cancelled,{reason:'Local only'});await assert.rejects(()=>act('student','link_po',{request_id:id,version:1,po_id:cancelled}),/active PO/);
 const pid=await existing({vendor:'Test Supplier'});await act('student','link_po',{request_id:id,version:1,po_id:pid});await finishApprovals(pid);await recordOrder(id);
 const before=await raw(id);await assert.rejects(()=>receipt(id,1000),/no greater/);assert.deepEqual(await raw(id),before);
 const trip=(await asUser('mentor',tx=>tx.query("select public.inventory_action('create_trip',$1) result",[JSON.stringify({name:'Local test trip'})]))).rows[0].result.id;
 const travelLocation=(await scalar('select id from public.locations where trip_id=$1 limit 1',[trip])).id;
 await assert.rejects(()=>receipt(id,1,'TRAVEL',randomUUID(),{location_id:travelLocation}),/non-travel/);
 assert.equal((await scalar('select count(*)::int n from inventory_purchasing.receipts where request_id=$1',[id])).n,0);
});
test('migration does not rewrite Finance functions, legacy order tags, item quantities or privileges',async()=>{
 assert.ok(!/create\s+(or replace\s+)?function\s+(public\.finance_|finance_private\.)/i.test(migration));
 assert.ok(!/update\s+public\.finance_purchase_orders/i.test(migration));
 assert.ok(!/update\s+public\.inventory_items/i.test(migration));
 assert.ok(!/grant\s+.*\s+on\s+public\.finance_/i.test(migration));
 assert.equal((await scalar("select count(*)::int n from public.inventory_items where order_status<>'Needs Order'")).n,0);
 assert.equal((await scalar("select count(*)::int n from public.finance_purchase_orders where status='submitted_to_school' and not finance_private.revision_approved(id,revision)")).n,0);
});
test('changed item area or unit prevents draft creation without creating an orphan PO',async()=>{
 const item=await makeItem();await setup(item);const id=await request(item);
 const before=(await scalar('select count(*)::int n from public.finance_purchase_orders')).n;
 await asUser('mentor',tx=>tx.query('update public.inventory_items set area_id=$1 where id=$2',[otherArea,item]));
 await assert.rejects(()=>createPO(id),/area or unit changed/);
 await asUser('mentor',tx=>tx.query("update public.inventory_items set area_id=$1,unit='box' where id=$2",[area,item]));
 await assert.rejects(()=>createPO(id),/area or unit changed/);
 assert.equal((await scalar('select count(*)::int n from public.finance_purchase_orders')).n,before);
 await act('student','cancel',{request_id:id,version:1,note:'Reconfigure changed unit'});
 await assert.rejects(()=>request(item),/conversion first/);
});
test('explicit do-not-restock policy blocks new requests without clearing the policy',async()=>{
 const item=await makeItem();await setup(item);await asUser('mentor',tx=>tx.query("update public.inventory_items set restock_policy='do_not_restock' where id=$1",[item]));
 await assert.rejects(()=>request(item),/marked do not restock/);
 assert.equal((await scalar('select restock_policy from public.inventory_items where id=$1',[item])).restock_policy,'do_not_restock');
 assert.equal((await context('student',item)).requests.length,0);
});
test('legacy Ordered stock permits reconciliation but blocks duplicate Finance draft creation',async()=>{
 const item=await makeItem();await setup(item);await asUser('mentor',tx=>tx.query("update public.inventory_items set order_status='Ordered' where id=$1",[item]));
 const id=await request(item),before=(await scalar('select count(*)::int n from public.finance_purchase_orders')).n;
 await assert.rejects(()=>createPO(id),/Already marked Ordered/);assert.equal((await scalar('select count(*)::int n from public.finance_purchase_orders')).n,before);
 const existing=(await asUser('student',tx=>tx.query("select public.finance_mutate('create',$1) id",[JSON.stringify({area_id:area,sheet_url:'https://docs.google.com/spreadsheets/d/local-test-only',vendor:'Test Supplier',amount:60,purpose:'Existing local PO to reconcile'})]))).rows[0].id;
 await act('student','link_po',{request_id:id,version:1,po_id:existing});assert.equal((await raw(id)).po_id,existing);
 assert.equal((await scalar('select order_status from public.inventory_items where id=$1',[item])).order_status,'Ordered');
});
test('delivery keys canonicalize ASCII and Unicode surrounding whitespace before replay or duplicate checks',async()=>{
 const item=await makeItem();await setup(item);const id=await request(item),pid=await createPO(id);await finishApprovals(pid);await recordOrder(id);
 const key=randomUUID(),version=(await raw(id)).version;
 const first={id:key,request_id:id,version,quantity:1,location_id:home,delivery_reference:'PACKING-SLIP-1',note:'Same delivery'};
 await act('counter','receive',first);
 await act('counter','receive',{...first,delivery_reference:'\tPACKING-SLIP-1\n'}); // same ID is an exact canonical replay
 for(const ref of ['\tPACKING-SLIP-1\n','\r\fPACKING-SLIP-1\v','\u00a0PACKING-SLIP-1\u00a0','\u2007PACKING-SLIP-1\u202f','\ufeffPACKING-SLIP-1\u3000'])await assert.rejects(()=>receipt(id,1,ref),/already been received/);
 assert.equal((await scalar('select count(*)::int n from inventory_purchasing.receipts where request_id=$1',[id])).n,1);
 assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[item])).quantity,4);
});

// Independent reviewer scenarios retained as regression tests.
test('review: capability revocation, inactive and readonly roles fail closed',async()=>{
 const item=await makeItem();await setup(item);const id=await request(item),pid=await createPO(id);await finishApprovals(pid);
 await db.query("insert into public.finance_assignments(user_id,capability,active,assigned_by) values($1,'school_submitter',true,$2)",[users.counter,users.mentor]);
 let c=await context('counter',item);assert.ok(c.requests[0].can_record_order);assert.equal(c.requests[0].po.id,pid);
 await db.query('update public.finance_assignments set active=false where user_id=$1',[users.counter]);
 c=await context('counter',item);assert.equal(c.requests[0].can_record_order,false);assert.equal(c.requests[0].po,null);
 await assert.rejects(()=>act('counter','record_order',{request_id:id,version:2,reference:'ORDER'}),/submitter/);
 await db.query("insert into public.team_member_positions(user_id,position_key) values($1,'finance_lead')",[users.readonly]);
 assert.equal((await context('readonly',item)).requests[0].po,null);
 for(const action of ['configure','request','create_po','link_po','record_order','receive','cancel','close_short','demo_finance_approve'])await assert.rejects(()=>act('readonly',action,{request_id:id}),/write access/);
 await db.query('update public.profiles set active=false where id=$1',[users.counter]);
 await assert.rejects(()=>context('counter',item),/Active/);await db.query('update public.profiles set active=true where id=$1',[users.counter]);
});
test('review: blocked policy does not prevent already approved delivery and every denial is atomic',async()=>{
 const item=await makeItem('ft');await setup(item,{units_per_pack:0.1,pack_cost:null});const id=await request(item,'student',3),pid=await createPO(id);await finishApprovals(pid);await recordOrder(id);
 await asUser('mentor',tx=>tx.query("update public.inventory_items set restock_policy='do_not_restock' where id=$1",[item]));
 for(const q of [null,'NaN','Infinity','-Infinity',-1,0,0.30000000001])await assert.rejects(()=>receipt(id,q),/positive/);
 assert.equal(Number((await raw(id)).received),0);assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[item])).quantity,3);
 await receipt(id,0.1,'Decimal A');await receipt(id,0.2,'Decimal B');assert.equal((await raw(id)).state,'received');assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[item])).quantity,3.3);
 await assert.rejects(()=>request(item),/do not restock/);
});
test('review: receiving never mutates Finance budget, approvals, status or notifications',async()=>{
 const sid=randomUUID(),cid=randomUUID();
 await db.query("insert into public.finance_seasons(id,name,starting_funds,status,created_by) values($1,'Independent budget probe',100,'active',$2)",[sid,users.mentor]);
 await db.query("insert into public.finance_budget_categories(id,season_id,name,allocation) values($1,$2,'Stock',50)",[cid,sid]);
 const item=await makeItem();await setup(item);const id=await request(item),pid=await createPO(id);await finance('student','submit',pid);
 await assert.rejects(()=>finance('finance','approve',pid,{slot:'finance_approver'}),/budget category/);
 await assert.rejects(()=>finance('finance','approve',pid,{slot:'finance_approver',category_id:cid}),/Over budget/);
 assert.equal((await scalar('select count(*)::int n from public.finance_po_approvals where po_id=$1',[pid])).n,0);
 await finance('finance','approve',pid,{slot:'finance_approver',category_id:cid,budget_reason:'Reviewed local fixture override'});await finance('coach','approve',pid,{slot:'po_approver'});await finance('mentor','school_submit',pid);
 const snapshot=async()=>({po:await scalar('select * from public.finance_purchase_orders where id=$1',[pid]),budget:await scalar('select * from public.finance_po_budget where po_id=$1',[pid]),season:await scalar('select * from public.finance_seasons where id=$1',[sid]),counts:await scalar('select (select count(*) from public.finance_po_approvals) approvals,(select count(*) from public.team_notifications) notices,(select count(*) from finance_private.history) history')});
 const before=await snapshot();await recordOrder(id);await receipt(id,5);await receipt(id,15);assert.deepEqual(await snapshot(),before);
 await db.query("update public.finance_seasons set status='closed' where id=$1",[sid]);
});
test('unsupported precision/range is rejected before JSON can hide a receiving remainder',async()=>{
 const item=await makeItem();await assert.rejects(()=>setup(item,{units_per_pack:0.0000001,pack_cost:null}),/check constraint/);
 await setup(item,{units_per_pack:999999.999999,pack_cost:null});
 await assert.rejects(()=>request(item,'student',999999),/supports totals/);
 assert.equal((await context('student',item)).requests.length,0);
 const normal=await makeItem();await setup(normal,{units_per_pack:0.001,pack_cost:null});const id=await request(normal),pid=await createPO(id);await finishApprovals(pid);await recordOrder(id);
 await assert.rejects(()=>receipt(id,0.0000001),/6 decimal/);
 assert.equal(Number((await raw(id)).received),0);
});
