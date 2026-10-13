import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
const db=new PGlite();const users={mentor:'00000000-0000-4000-8000-000000000001',student:'00000000-0000-4000-8000-000000000002',lead:'00000000-0000-4000-8000-000000000003',readonly:'00000000-0000-4000-8000-000000000004'};
const home='10000000-0000-4000-8000-000000000001',project='10000000-0000-4000-8000-000000000002',motor='20000000-0000-4000-8000-000000000001',drill='20000000-0000-4000-8000-000000000002',wrench='20000000-0000-4000-8000-000000000003',area='44180000-0000-4000-8000-000000000001';
const asUser=(who,fn)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[users[who]]);return fn(tx);});
const action=(who,name,data)=>asUser(who,tx=>tx.query('select public.inventory_action($1,$2) as result',[name,JSON.stringify(data)]));
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const counts=async id=>(await db.query('select location_id,quantity::float from public.inventory_balances where inventory_item_id=$1 order by location_id',[id])).rows;
let trip,trailer,pit;
before(async()=>{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;");
 for(const [who,id]of Object.entries(users))await db.query('insert into auth.users(id,email) values($1,$2)',[id,who+'@example.test']);
 for(const f of ['001_initial_schema.sql','002_rls_policies.sql','003_operations_and_seed.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
 for(const [who,id]of Object.entries(users))await db.query('update public.profiles set role=$1,primary_area_id=$2 where id=$3',[who,who==='lead'?area:null,id]);
 await asUser('mentor',async tx=>{await tx.query("insert into public.locations(id,name,location_type) values($1,'P-03','Drawer'),($2,'Shooter Prototype','Storage')",[home,project]);await tx.query("insert into public.inventory_items(id,name,area_id,category,item_type,ownership,quantity,expected_quantity,minimum_quantity,target_quantity,location_id) values($1,'Kraken X60',$4,'Tools','Part','FRC 4418',8,8,4,8,$5),($2,'School Drill',$4,'Tools','Tool','Shared / School',2,2,0,2,$5),($3,'5/32 Allen Wrench',$4,'Tools','Tool','Shared / School',4,4,2,6,$5)",[motor,drill,wrench,area,home]);});
 for(const f of ['004_balances_travel_media.sql','005_private_inventory_media.sql','20261013234535_tool_checkouts.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
});
after(()=>db.close());
const toolAction=(who,name,data)=>asUser(who,tx=>tx.query('select public.tool_checkout_action($1,$2) as result',[name,JSON.stringify(data)]));
const loan=async id=>scalar('select *,updated_at::text as version from public.tool_loans where id=$1',[id]);
const op=()=>crypto.randomUUID();
const checkout=(itemId=drill,quantity=1)=>({operationId:op(),itemId,from:home,to:project,quantity,borrower:'Demo borrower',project:'Test project',expectedReturn:'2026-12-31',note:'Local test only'});
let firstLoan;
test('checkout transfers physical stock, preserves owned total and replay is idempotent',async()=>{
 const data=checkout(drill,2);firstLoan=(await toolAction('student','checkout',data)).rows[0].result.id;
 assert.deepEqual(await counts(drill),[{location_id:home,quantity:0},{location_id:project,quantity:2}]);
 assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[drill])).quantity,2);
 assert.equal((await loan(firstLoan)).borrower,'Demo borrower');
 const repeated=await Promise.all([toolAction('student','checkout',data),toolAction('student','checkout',data)]);
 assert.ok(repeated.every(x=>x.rows[0].result.replayed));assert.equal((await scalar('select count(*)::int n from public.tool_loans')).n,1);
 await assert.rejects(()=>toolAction('student','checkout',{...data,quantity:1}),/different request/);
 await assert.rejects(()=>toolAction('mentor','checkout',data),/different request/);
});
test('only Tools are eligible; invalid, fractional and overcommitted quantities roll back',async()=>{
 const before=await counts(motor);for(const quantity of [0,-1,0.5,3])await assert.rejects(()=>toolAction('student','checkout',checkout(drill,quantity)),/whole number|Not enough/);
 await assert.rejects(()=>toolAction('student','checkout',checkout(motor,1)),/Only Tool/);assert.deepEqual(await counts(motor),before);
 await assert.rejects(()=>toolAction('student','checkout',{...checkout(wrench),borrower:' '}),/who has/);
 await assert.rejects(()=>toolAction('student','checkout',{...checkout(wrench),expectedReturn:''}),/return date/);
 await assert.rejects(()=>toolAction('student','checkout',{...checkout(wrench),expectedReturn:'2026-02-30'}),/date/);
 await assert.rejects(()=>toolAction('student','checkout',{...checkout(wrench),to:home}),/different/);
});
test('existing role gates hold and direct loan or receipt writes are not exposed',async()=>{
 await assert.rejects(()=>toolAction('readonly','checkout',checkout(wrench)),/permission/);
 for(const who of ['student','lead','mentor']){
  await assert.rejects(()=>asUser(who,tx=>tx.query("update public.tool_loans set borrower='Forged'")),/permission/);
  await assert.rejects(()=>asUser(who,tx=>tx.query('delete from public.tool_loans')),/permission/);
  await assert.rejects(()=>asUser(who,tx=>tx.query('select * from private.tool_checkout_operations')),/permission/);
 }
 assert.equal((await asUser('readonly',tx=>tx.query('select count(*)::int n from public.tool_loans'))).rows[0].n,1);
 await db.query('update public.profiles set active=false where id=$1',[users.student]);
 await assert.rejects(async()=>toolAction('student','mark_missing',{operationId:op(),loanId:firstLoan,updatedAt:(await loan(firstLoan)).version,note:'Missing'}),/permission/);
 assert.equal((await asUser('student',tx=>tx.query('select count(*)::int n from public.tool_loans'))).rows[0].n,0);
 await db.query('update public.profiles set active=true where id=$1',[users.student]);
});
test('generic movements/counts and type changes cannot consume outstanding loans',async()=>{
 const before=await counts(drill),version=(await scalar('select updated_at::text v from public.inventory_items where id=$1',[drill])).v;
 await assert.rejects(()=>action('student','move',{itemId:drill,from:project,to:home,quantity:1}),/Outstanding tool loans/);
 await assert.rejects(()=>action('student','adjust',{itemId:drill,from:project,quantity:1,updatedAt:version}),/Outstanding tool loans/);
 await assert.rejects(()=>asUser('mentor',tx=>tx.query("update public.inventory_items set item_type='Consumable' where id=$1",[drill])),/outstanding tool loans/);
 await assert.rejects(()=>asUser('mentor',tx=>tx.query("update public.inventory_items set ownership='FRC 4418' where id=$1",[drill])),/outstanding tool loans/);
 await assert.rejects(()=>asUser('mentor',tx=>tx.query('delete from public.inventory_items where id=$1',[drill])),/foreign key/);assert.deepEqual(await counts(drill),before);
});
test('missing status preserves balances/owned total; partial return targets exactly one loan',async()=>{
 let l=await loan(firstLoan);const before=await counts(drill);
 await assert.rejects(()=>toolAction('student','mark_missing',{operationId:op(),loanId:l.id,updatedAt:l.version,note:''}),/note/);
 await toolAction('student','mark_missing',{operationId:op(),loanId:l.id,updatedAt:l.version,note:'Not at expected project location'});
 assert.equal((await loan(l.id)).status,'missing');assert.deepEqual(await counts(drill),before);
 l=await loan(l.id);const data={operationId:op(),loanId:l.id,quantity:1,updatedAt:l.version,note:'One recovered and returned'};
 await toolAction('lead','return',data);await toolAction('lead','return',data);
 assert.deepEqual(await counts(drill),[{location_id:home,quantity:1},{location_id:project,quantity:1}]);assert.equal((await loan(l.id)).returned_quantity,'1');assert.equal((await loan(l.id)).status,'missing');
 await assert.rejects(()=>toolAction('student','return',{...data,operationId:op()}),/changed/);
 const current=await loan(l.id);await assert.rejects(()=>toolAction('student','return',{operationId:op(),loanId:l.id,quantity:2,updatedAt:current.version}),/exceeds/);
 await toolAction('student','mark_found',{operationId:op(),loanId:l.id,updatedAt:current.version,note:'Remaining tool found'});
 assert.equal((await loan(l.id)).status,'out');assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[drill])).quantity,2);
});
test('distinct concurrent returns cannot both spend the same loan snapshot',async()=>{
 const l=await loan(firstLoan);const results=await Promise.allSettled([1,2].map(()=>toolAction('student','return',{operationId:op(),loanId:l.id,quantity:1,updatedAt:l.version})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await loan(l.id)).status,'returned');assert.deepEqual(await counts(drill),[{location_id:home,quantity:2},{location_id:project,quantity:0}]);
 await assert.rejects(async()=>toolAction('student','return',{operationId:op(),loanId:l.id,quantity:1,updatedAt:(await loan(l.id)).version}),/already returned/);
});
test('trip approvals and packing cannot double-spend custody; loaned travel is rejected',async()=>{
 const tid=(await action('mentor','create_trip',{name:'Loan guard test'})).rows[0].result.id;
 const trailer=(await scalar("select id from public.locations where trip_id=$1 and name='Trailer'",[tid])).id;await action('mentor','trip_status',{tripId:tid,status:'packing'});
 const mid=(await action('mentor','approve',{tripId:tid,itemId:drill,from:home,to:trailer,quantity:2})).rows[0].result.id;
 await assert.rejects(()=>toolAction('student','checkout',checkout(drill,2)),/Not enough/);
 await action('mentor','resolve',{manifestId:mid,quantity:2,note:'Use checkout workflow instead'});
 await toolAction('student','checkout',checkout(drill,2));
 await assert.rejects(()=>action('student','pack',{manifestId:mid,quantity:2}),/Not enough|Allocation changed|Source and destination/);
 await assert.rejects(()=>action('mentor','approve',{tripId:tid,itemId:drill,from:project,to:trailer,quantity:1}),/Outstanding tool loans/);
 await assert.rejects(()=>toolAction('student','checkout',{...checkout(wrench),to:trailer}),/non-travel/);
 assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[drill])).quantity,2);
});
test('separate borrowers retain independent claims and returns do not clear someone else',async()=>{
 const a=(await toolAction('student','checkout',checkout(wrench,1))).rows[0].result.id;
 const b=(await toolAction('mentor','checkout',{...checkout(wrench,2),borrower:'Other borrower'})).rows[0].result.id;
 await action('student','move',{itemId:wrench,from:home,to:project,quantity:1});await action('student','move',{itemId:wrench,from:project,to:home,quantity:1});
 await assert.rejects(()=>action('student','move',{itemId:wrench,from:project,to:home,quantity:1}),/Outstanding/);
 await toolAction('student','return',{operationId:op(),loanId:a,quantity:1,updatedAt:(await loan(a)).version});
 assert.equal((await loan(a)).status,'returned');assert.equal((await loan(b)).returned_quantity,'0');assert.deepEqual(await counts(wrench),[{location_id:home,quantity:2},{location_id:project,quantity:2}]);
});
test('unencumbered tools still pack and return normally after checkout upgrade',async()=>{
 const tid=(await action('mentor','create_trip',{name:'Unrelated trip regression'})).rows[0].result.id;
 const target=(await scalar("select id from public.locations where trip_id=$1 and name='Trailer'",[tid])).id;
 await action('mentor','trip_status',{tripId:tid,status:'packing'});
 const mid=(await action('mentor','approve',{tripId:tid,itemId:wrench,from:home,to:target,quantity:2})).rows[0].result.id;
 await action('student','pack',{manifestId:mid,quantity:2});await action('student','return',{manifestId:mid,quantity:2});await action('mentor','trip_status',{tripId:tid,status:'closed'});
 assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[wrench])).quantity,4);
 assert.equal((await scalar("select sum(quantity-returned_quantity)::float q from public.tool_loans where inventory_item_id=$1 and status<>'returned'",[wrench])).q,2);
});
test('location audit with outstanding loans stamps verification without altering custody or balances',async()=>{
 const snapshots=async()=>(await db.query('select id,updated_at::text from public.inventory_items where location_id=$1 or id in(select inventory_item_id from public.inventory_balances where location_id=$1 and quantity>0)',[project])).rows;
 const stale=await snapshots();const balancesBefore=await db.query('select inventory_item_id,location_id,quantity::float from public.inventory_balances order by inventory_item_id,location_id');const loansBefore=await db.query('select * from public.tool_loans order by id');
 await asUser('student',tx=>tx.query('select public.verify_balance_location($1,$2)',[project,JSON.stringify(stale)]));
 assert.deepEqual((await db.query('select inventory_item_id,location_id,quantity::float from public.inventory_balances order by inventory_item_id,location_id')).rows,balancesBefore.rows);assert.deepEqual((await db.query('select * from public.tool_loans order by id')).rows,loansBefore.rows);
 assert.equal((await scalar('select last_verified_by from public.inventory_balances where inventory_item_id=$1 and location_id=$2',[drill,project])).last_verified_by,users.student);
 const verifiedBefore=await db.query('select * from public.inventory_balances order by id');
 await assert.rejects(()=>asUser('student',tx=>tx.query('select public.verify_balance_location($1,$2)',[project,JSON.stringify(stale)])),/changed/);
 assert.deepEqual((await db.query('select * from public.inventory_balances order by id')).rows,verifiedBefore.rows);
 await assert.rejects(()=>action('student','move',{itemId:drill,from:project,to:home,quantity:1}),/Outstanding tool loans/);
});
test('empty loan origin remains available until every outstanding tool returns',async()=>{
 const source=(await action('mentor','create_location',{name:'Temporary loan origin',classification:'project'})).rows[0].result.id;
 await action('student','move',{itemId:wrench,from:home,to:source,quantity:2});const id=(await toolAction('student','checkout',{...checkout(wrench,2),from:source})).rows[0].result.id;
 await assert.rejects(()=>asUser('mentor',tx=>tx.query('update public.locations set active=false where id=$1',[source])),/outstanding tool loans/);
 await assert.rejects(()=>asUser('mentor',tx=>tx.query("update public.locations set classification='travel' where id=$1",[source])),/outstanding tool loans/);assert.equal((await scalar('select active from public.locations where id=$1',[source])).active,true);
 await toolAction('student','return',{operationId:op(),loanId:id,quantity:2,updatedAt:(await loan(id)).version});await action('student','move',{itemId:wrench,from:source,to:home,quantity:2});await asUser('mentor',tx=>tx.query('update public.locations set active=false where id=$1',[source]));assert.equal((await scalar('select active from public.locations where id=$1',[source])).active,false);
});
