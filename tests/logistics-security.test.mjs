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
 for(const f of ['004_balances_travel_media.sql','005_private_inventory_media.sql','20261021021658_student_item_creation.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
});
after(()=>db.close());
test('migration preserves counts and duplicate execution is explicitly rejected',async()=>{
 assert.deepEqual(await counts(motor),[{location_id:home,quantity:8}]);assert.equal((await scalar('select quantity::float,expected_quantity::float from public.inventory_items where id=$1',[wrench])).expected_quantity,4);
 const migration=await readFile(new URL('../supabase/migrations/004_balances_travel_media.sql',import.meta.url),'utf8');
 await assert.rejects(()=>db.exec(migration),/already applied/);await db.exec('rollback');
});

test('project transfer preserves total and logs authenticated source/destination',async()=>{
 await action('student','move',{itemId:motor,from:home,to:project,quantity:2,note:'Prototype test'});
 assert.deepEqual(await counts(motor),[{location_id:home,quantity:6},{location_id:project,quantity:2}]);assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[motor])).quantity,8);
 const log=await scalar("select * from public.inventory_movements where inventory_item_id=$1 and movement_type='transfer'",[motor]);assert.equal(log.user_id,users.student);assert.equal(log.from_location_id,home);assert.equal(log.to_location_id,project);
 const before=await counts(motor);await assert.rejects(()=>action('student','move',{itemId:motor,from:home,to:project,quantity:99}),/Not enough/);assert.deepEqual(await counts(motor),before);
 await assert.rejects(()=>action('student','move',{itemId:motor,from:home,quantity:1}),/destination/);
});
test('balance and movement tables cannot be directly forged; readonly cannot move',async()=>{
 for(const who of ['student','mentor'])await assert.rejects(()=>asUser(who,tx=>tx.query('update public.inventory_balances set quantity=999')),/permission/);
 await assert.rejects(()=>asUser('mentor',tx=>tx.query("delete from public.inventory_movements")),/permission/);
 await assert.rejects(()=>action('readonly','move',{itemId:motor,from:home,to:project,quantity:1}),/permission/);
 await assert.rejects(()=>action('student','create_trip',{name:'Unauthorized'}),/Only admins/);
});
test('school trip partial movements and returns preserve origin and total',async()=>{
 trip=(await action('mentor','create_trip',{name:'2026 Denver Regional'})).rows[0].result.id;
 trailer=(await scalar("select id from public.locations where trip_id=$1 and name='Trailer'",[trip])).id;pit=(await scalar("select id from public.locations where trip_id=$1 and name='Pit Toolbox B'",[trip])).id;
 await action('mentor','trip_status',{tripId:trip,status:'packing'});
 await assert.rejects(()=>action('student','approve',{tripId:trip,itemId:drill,from:home,to:trailer,quantity:2}),/approve/);
 await assert.rejects(()=>action('student','pack',{tripId:trip,itemId:drill,from:home,to:trailer,quantity:1}),/approved manifest/);
 const mid=(await action('lead','approve',{tripId:trip,itemId:drill,from:home,to:trailer,quantity:2})).rows[0].result.id;
 await action('student','pack',{manifestId:mid,quantity:2});await action('student','internal',{manifestId:mid,to:pit,quantity:1});
 assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[drill])).quantity,2);
 const rows=(await db.query("select * from public.trip_manifest_items where trip_id=$1 and status='packed'",[trip])).rows;assert.equal(rows.length,2);assert.ok(rows.every(m=>m.home_location_id===home));
 await assert.rejects(()=>action('mentor','trip_status',{tripId:trip,status:'closed'}),/Unresolved/);
 for(const row of rows)await action('student','return',{manifestId:row.id,quantity:1});
 assert.equal((await scalar("select sum(quantity)::float as quantity from public.trip_manifest_items where trip_id=$1 and status='returned'",[trip])).quantity,2);
 await action('mentor','trip_status',{tripId:trip,status:'closed'});assert.equal((await scalar('select count(*)::int as n from public.locations where trip_id=$1 and active',[trip])).n,0);
 assert.equal((await scalar('select quantity::float from public.inventory_balances where inventory_item_id=$1 and location_id=$2',[drill,home])).quantity,2);
});
test('assigned elsewhere remains tracked; loss correction exposes unaccounted stock',async()=>{
 await action('student','move',{itemId:wrench,from:home,to:project,quantity:1});assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[wrench])).quantity,4);
 const version=(await scalar('select updated_at::text from public.inventory_items where id=$1',[wrench])).updated_at;
 await action('student','adjust',{itemId:wrench,from:project,quantity:0,updatedAt:version,note:'Unable to locate at project'});
 assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[wrench])).quantity,3);
 await assert.rejects(()=>action('student','adjust',{itemId:wrench,from:home,quantity:4,updatedAt:version}),/changed/);
});
test('legacy quantity bridge cannot consume stock allocated elsewhere',async()=>{
 await assert.rejects(()=>asUser('student',tx=>tx.query('update public.inventory_items set quantity=1 where id=$1',[motor])),/elsewhere/);
 await asUser('student',tx=>tx.query('select public.change_inventory_quantity($1,-1)',[motor]));assert.equal((await scalar('select quantity::float from public.inventory_balances where inventory_item_id=$1 and location_id=$2',[motor,home])).quantity,5);
 await assert.rejects(()=>asUser('mentor',tx=>tx.query('update public.inventory_items set location_id=$1 where id=$2',[project,motor])),/allocated/);
});
test('private media permissions follow area roles and prevent arbitrary references',async()=>{
 const path=`items/${motor}/photo.png`;
 await assert.rejects(()=>asUser('student',tx=>tx.query("insert into storage.objects(bucket_id,name) values('inventory-media',$1)",[path])),/row.level/);
 await asUser('lead',tx=>tx.query("insert into storage.objects(bucket_id,name) values('inventory-media',$1)",[path]));
 await asUser('lead',tx=>tx.query("insert into public.inventory_media(entity_type,entity_id,path,alt_text) values('items',$1,$2,'Kraken motor')",[motor,path]));
 const result=await asUser('student',tx=>tx.query('delete from public.inventory_media returning id'));assert.equal(result.rows.length,0);
 await assert.rejects(()=>asUser('mentor',tx=>tx.query("insert into public.inventory_media(entity_type,entity_id,path) values('items',$1,$2)",[drill,`items/${drill}/missing.png`])),/Upload/);
 assert.equal((await scalar("select public from storage.buckets where id='inventory-media'")).public,false);
});

test('loss requires an explicit mentor resolution, reduces ownership, and permits clean closure',async()=>{
 const tid=(await action('mentor','create_trip',{name:'Loss audit test'})).rows[0].result.id;
 const target=(await scalar("select id from public.locations where trip_id=$1 and name='Trailer'",[tid])).id;
 await action('mentor','trip_status',{tripId:tid,status:'packing'});
 const id=(await action('mentor','approve',{tripId:tid,itemId:drill,from:home,to:target,quantity:2})).rows[0].result.id;
 await action('student','pack',{manifestId:id,quantity:2});
 await assert.rejects(()=>action('student','resolve',{manifestId:id,quantity:1,resolution:'lost',note:'Missing'}),/mentor/);
 await assert.rejects(()=>action('mentor','resolve',{manifestId:id,quantity:1,resolution:'lost',note:''}),/note/);
 await action('mentor','resolve',{manifestId:id,quantity:1,resolution:'lost',note:'Searched pit and trailer; one drill missing'});
 assert.equal((await scalar('select quantity::float from public.inventory_items where id=$1',[drill])).quantity,1);
 await action('student','return',{manifestId:id,quantity:1});await action('mentor','trip_status',{tripId:tid,status:'closed'});
 assert.equal((await scalar("select count(*)::int as n from public.trip_manifest_items where trip_id=$1 and status='resolved' and resolution like 'lost:%'",[tid])).n,1);
});

test('balance-location audit rejects stale snapshots and stamps only that location',async()=>{
 const list=async()=>(await db.query('select id,updated_at::text from public.inventory_items where location_id=$1 or id in(select inventory_item_id from public.inventory_balances where location_id=$1 and quantity>0)',[home])).rows;
 const stale=await list();await action('student','adjust',{itemId:wrench,from:home,delta:1});
 await assert.rejects(()=>asUser('student',tx=>tx.query('select public.verify_balance_location($1,$2)',[home,JSON.stringify(stale)])),/changed/);
 const fresh=await list();await asUser('student',tx=>tx.query('select public.verify_balance_location($1,$2)',[home,JSON.stringify(fresh)]));
 assert.equal((await scalar('select last_verified_by from public.inventory_balances where inventory_item_id=$1 and location_id=$2',[wrench,home])).last_verified_by,users.student);
 assert.equal((await scalar('select last_verified_at from public.inventory_balances where inventory_item_id=$1 and location_id=$2',[wrench,project])).last_verified_at,null);
});

test('student creation initializes home balance and cannot bypass location or photo restrictions',async()=>{
 await assert.rejects(()=>asUser('student',async tx=>{
  const {rows:[created]}=await tx.query("insert into public.inventory_items(name,area_id,category,quantity,location_id) values('Synthetic home part',$1,'Tools',3,$2) returning *",[area,home]);
  assert.equal(created.created_by,users.student);
  const record={...created,id:'20000000-0000-4000-8000-000000000098',name:'Synthetic RPC home part'};
  await tx.query('select public.apply_inventory_changes($1)',[JSON.stringify({items:[{record}]})]);
  const rpcBalance=await tx.query('select quantity::float from public.inventory_balances where inventory_item_id=$1 and location_id=$2',[record.id,home]);assert.equal(rpcBalance.rows[0].quantity,3);

  const balance=await tx.query('select quantity::float from public.inventory_balances where inventory_item_id=$1 and location_id=$2',[created.id,home]);assert.equal(balance.rows[0].quantity,3);
  const history=await tx.query("select user_id from public.inventory_events where inventory_item_id=$1 and event_type='item_created'",[created.id]);assert.equal(history.rows[0].user_id,users.student);
  assert.equal((await tx.query('delete from public.inventory_items where id=$1 returning id',[created.id])).rows.length,0);
  throw new Error('fixture rollback');
 }),/^Error: fixture rollback$/);
 await assert.rejects(()=>asUser('student',tx=>tx.query("insert into public.inventory_items(name,area_id,category,quantity,location_id) values('Invalid home',$1,'Tools',3,'10000000-0000-4000-8000-000000000099')",[area])),/foreign key|location|home/i);
});
