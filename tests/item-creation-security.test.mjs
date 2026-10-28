import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';

// Isolated synthetic database only. No credentials, production data or network.
const db=new PGlite();
const users={mentor:'00000000-0000-4000-8000-000000000001',student:'00000000-0000-4000-8000-000000000002',lead:'00000000-0000-4000-8000-000000000003',unassignedLead:'00000000-0000-4000-8000-000000000004',inactiveLead:'00000000-0000-4000-8000-000000000005',readonly:'00000000-0000-4000-8000-000000000006',outsider:'00000000-0000-4000-8000-000000000007',admin:'00000000-0000-4000-8000-000000000008'};
const area='44180000-0000-4000-8000-000000000001',other='44180000-0000-4000-8000-000000000002';
const home='10000000-0000-4000-8000-000000000001',archived='10000000-0000-4000-8000-000000000002';
const item='20000000-0000-4000-8000-000000000001',rpcItem='20000000-0000-4000-8000-000000000002';
const asUser=(who,fn)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[users[who]]);return fn(tx);});
const rollback=(who,fn)=>assert.rejects(()=>asUser(who,async tx=>{await fn(tx);throw new Error('fixture rollback');}),/^Error: fixture rollback$/);
const load=async file=>db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
const protectedState=async()=>({
 functions:(await db.query("select n.nspname,p.proname,pg_get_functiondef(p.oid) definition,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname in ('can_edit','current_role','guard_item','bridge_item_balance','can_count','is_admin')) or (n.nspname='public' and p.proname in ('inventory_action','apply_inventory_changes')) order by n.nspname,p.proname")).rows,
 policies:(await db.query("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename in ('inventory_items','locations','inventory_media','profiles') order by tablename,policyname")).rows,
 helperAcl:(await db.query("select proacl from pg_proc where oid='private.can_create_item(uuid)'::regprocedure")).rows,
});
let beforeMigration,tripHome,legacyUnassignedDenied=false;
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 for(const [key,id] of Object.entries(users))await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${key}@example.test`]);
 for(const file of ['001_initial_schema.sql','002_rls_policies.sql','003_operations_and_seed.sql','004_balances_travel_media.sql','005_private_inventory_media.sql','20261021021658_student_item_creation.sql'])await load(file);
 for(const [key,id] of Object.entries(users))await db.query('update public.profiles set role=$1,primary_area_id=$2,active=$3 where id=$4',[key.endsWith('Lead')?'lead':key==='outsider'?'student':key,key==='lead'?area:null,key!=='inactiveLead',id]);
 await db.query('delete from public.profiles where id=$1',[users.outsider]);
 await asUser('mentor',async tx=>{
  await tx.query("insert into public.locations(id,name,location_type,active) values($1,'Synthetic home','Drawer',true),($2,'Synthetic archived','Storage',false)",[home,archived]);
  await tx.query("insert into public.inventory_items(id,name,area_id,category,quantity,location_id) values($1,'Synthetic existing part',$2,'Tools',3,$3)",[item,other,home]);
  const {rows:[{result}]}=await tx.query("select public.inventory_action('create_trip',$1) result",[JSON.stringify({name:'Synthetic trip'})]);
  tripHome=(await tx.query('select id from public.locations where trip_id=$1 limit 1',[result.id])).rows[0].id;
 });
 legacyUnassignedDenied=!(await asUser('unassignedLead',tx=>tx.query('select private.can_create_item($1) allowed',[other]))).rows[0].allowed;
 beforeMigration=await protectedState();
 await load('20261028020953_lead_item_creation.sql');
});
after(()=>db.close());

test('migration fixes the unassigned Lead gate without touching edit/delete/media/admin policies',async()=>{
 assert.equal(legacyUnassignedDenied,true);
 assert.deepEqual(await protectedState(),beforeMigration);
 const {rows:[helper]}=await db.query("select prosecdef,proconfig from pg_proc where oid='private.can_create_item(uuid)'::regprocedure");
 assert.equal(helper.prosecdef,false);assert.ok(helper.proconfig.some(v=>v.startsWith('search_path=')));
 assert.equal((await db.query("select has_function_privilege('anon','private.can_create_item(uuid)','execute') allowed")).rows[0].allowed,false);
});

for(const who of ['student','lead','unassignedLead','mentor','admin'])test(`${who} can create through table and patch RPC with balances and server attribution`,async()=>{
 await rollback(who,async tx=>{
  const {rows:[created]}=await tx.query("insert into public.inventory_items(name,area_id,category,quantity,location_id,created_by,updated_by) values('Synthetic new part',$1,'Tools',3,$2,$3,$3) returning *",[other,home,users.mentor]);
  assert.equal(created.created_by,users[who]);assert.equal(created.updated_by,users[who]);
  const record={...created,id:rpcItem,name:'Synthetic RPC part',created_by:users.mentor,updated_by:users.mentor};
  await tx.query('select public.apply_inventory_changes($1)',[JSON.stringify({items:[{record}]})]);
  for(const id of [created.id,rpcItem]){
   assert.equal((await tx.query('select created_by from public.inventory_items where id=$1',[id])).rows[0].created_by,users[who]);
   assert.equal((await tx.query('select quantity::float from public.inventory_balances where inventory_item_id=$1 and location_id=$2',[id,home])).rows[0].quantity,3);
   assert.equal((await tx.query("select user_id from public.inventory_events where inventory_item_id=$1 and event_type='item_created'",[id])).rows[0].user_id,users[who]);
  }
  if(['student','lead','unassignedLead'].includes(who))assert.equal((await tx.query('delete from public.inventory_items where id=$1 returning id',[created.id])).rows.length,0);
 });
});

test('readonly, inactive Lead, non-member and anonymous identities still cannot create',async()=>{
 const record={...(await db.query('select * from public.inventory_items where id=$1',[item])).rows[0],id:rpcItem};
 for(const who of ['readonly','inactiveLead','outsider']){
  await assert.rejects(()=>asUser(who,tx=>tx.query("insert into public.inventory_items(name,area_id,category,location_id) values('Denied',$1,'Tools',$2)",[other,home])),/cannot create|row.level|permission/);
  await assert.rejects(()=>asUser(who,tx=>tx.query('select public.apply_inventory_changes($1)',[JSON.stringify({items:[{record}]})])),/cannot create|row.level|permission/);
 }
 await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select public.apply_inventory_changes($1)',[JSON.stringify({items:[{record}]})]);}),/permission/);
});

test('Lead creation does not authorize outside-area metadata, photos, configuration or role changes',async()=>{
 for(const who of ['lead','unassignedLead']){
  await assert.rejects(()=>asUser(who,tx=>tx.query("update public.inventory_items set name='Denied' where id=$1",[item])),/metadata/);
  await assert.rejects(()=>asUser(who,tx=>tx.query("insert into storage.objects(bucket_id,name) values('inventory-media',$1)",[`items/${item}/synthetic.png`])),/row.level|permission/);
  await assert.rejects(()=>asUser(who,tx=>tx.query("insert into public.areas(slug,name) values('denied','Denied')")),/row.level|permission/);
  assert.equal((await asUser(who,tx=>tx.query("update public.profiles set role='admin' where id=$1 returning id",[users[who]]))).rows.length,0);
  await rollback(who,tx=>tx.query('select public.change_inventory_quantity($1,1)',[item]));
 }
});

test('Lead item creation cannot use archived, travel or missing home locations',async()=>{
 for(const who of ['lead','unassignedLead'])for(const location of [archived,tripHome,'10000000-0000-4000-8000-000000000099']){
  await assert.rejects(()=>asUser(who,tx=>tx.query("insert into public.inventory_items(name,area_id,category,location_id) values('Denied home',$1,'Tools',$2)",[other,location])),/home location|foreign key/);
 }
});
