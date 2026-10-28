import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';

// Synthetic records only: never use the live team roster or Auth identities.
const db=new PGlite();
const users=Object.fromEntries(['mentor','admin','lead','student','assigned','readonly','inactive','pending','banned','unconfirmed','inactiveMember','revoked','archivedPosition','programManager','projectManager','coach','otherPosition'].map((key,index)=>[key,`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`]));
const area='44180000-0000-4000-8000-000000000001',other='44180000-0000-4000-8000-000000000002';
let originalAction;
const functionalPositions=['business_lead','cad_lead','communications_lead','fabrication_lead','finance_lead','operations_lead','power_lead','software_lead','strategy_lead'];
const asUser=(who,fn)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[users[who]??who]);return fn(tx);});
const action=(who,data)=>asUser(who,tx=>tx.query("select public.inventory_action('create_location',$1) result",[JSON.stringify({name:'Synthetic new location',classification:'project',areaId:area,...data})]));
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',last_sign_in_at timestamptz default now(),email_confirmed_at timestamptz default now(),banned_until timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 for(const [key,id] of Object.entries(users))await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${key}@example.test`]);
 for(const file of ['001_initial_schema.sql','002_rls_policies.sql','003_operations_and_seed.sql','004_balances_travel_media.sql','005_private_inventory_media.sql','20261021021658_student_item_creation.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 for(const [key,id] of Object.entries(users))await db.query('update public.profiles set role=$1,primary_area_id=$2,active=$3 where id=$4',[['mentor','admin','lead','readonly'].includes(key)?key:'student',area,key!=='inactive',id]);
 await db.exec(`create table public.team_positions(key text primary key,name text not null,active boolean not null default true,category text not null default 'Functional Leads');
 create table public.team_member_positions(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles,position_key text not null references public.team_positions,revoked_at timestamptz);
 create table public.team_attendance_members(student_id uuid primary key references public.profiles,member_status text not null);
 alter table public.team_positions enable row level security;alter table public.team_member_positions enable row level security;alter table public.team_attendance_members enable row level security;
 revoke all on public.team_positions,public.team_member_positions,public.team_attendance_members from public,anon,authenticated;`);
 for(const key of [...functionalPositions,'program_manager','product_technical_manager','lead_coach_1','other_role','archived_lead'])await db.query('insert into public.team_positions(key,name,active) values($1,$1,$2)',[key,key!=='archived_lead']);
 for(const key of ['assigned','readonly','inactive','pending','banned','unconfirmed','inactiveMember','revoked'])await db.query('insert into public.team_member_positions(user_id,position_key,revoked_at) values($1,$2,$3)',[users[key],'software_lead',key==='revoked'?new Date():null]);
 for(const [key,position] of [['archivedPosition','archived_lead'],['programManager','program_manager'],['projectManager','product_technical_manager'],['coach','lead_coach_1'],['otherPosition','other_role']])await db.query('insert into public.team_member_positions(user_id,position_key) values($1,$2)',[users[key],position]);
 await db.query("insert into public.team_attendance_members(student_id,member_status) values($1,'inactive')",[users.inactiveMember]);
 await db.query('update auth.users set last_sign_in_at=null where id=$1',[users.pending]);
 await db.query('update auth.users set email_confirmed_at=null where id=$1',[users.unconfirmed]);
 await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[users.banned]);
 originalAction=(await db.query("select pg_get_functiondef('public.inventory_action(text,jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(await readFile(new URL('../supabase/migrations/20261028011601_assigned_student_lead_location_creation.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
test('legacy lead creation is still only a project in the assigned area',async()=>{
 const {rows:[{result}]}=await action('lead',{areaId:other});
 const {rows:[location]}=await db.query('select * from public.locations where id=$1',[result.id]);
 assert.equal(location.area_id,area);assert.equal(location.classification,'project');
 await assert.rejects(()=>action('lead',{classification:'permanent'}),/project locations/);
});
test('mentor and admin existing location creation remains available',async()=>{
 for(const who of ['mentor','admin']){const {rows:[{result}]}=await action(who,{classification:'permanent',areaId:other});assert.ok(result.id);}
});
test('students cannot mutate locations directly or through the admin patch RPC',async()=>{
 for(const who of ['student','assigned']){
  await assert.rejects(()=>asUser(who,tx=>tx.query("insert into public.locations(name,classification) values('Not allowed','permanent')")),/row.level|permission/);
  await assert.rejects(()=>asUser(who,tx=>tx.query('select public.apply_inventory_changes($1)',[JSON.stringify({locations:[{record:{id:'10000000-0000-4000-8000-000000000099',name:'Not allowed'}}]})])),/admin|mentor|permission|row.level/i);
  assert.equal((await asUser(who,tx=>tx.query("update public.locations set name='Not allowed' returning id"))).rows.length,0);
  assert.equal((await asUser(who,tx=>tx.query('delete from public.locations returning id'))).rows.length,0);
 }
});
test('unassigned, readonly, inactive, pending, banned and invalid assignments cannot create',async()=>{
 for(const who of ['student','readonly','inactive','pending','banned','unconfirmed','inactiveMember','revoked','archivedPosition','otherPosition','coach'])await assert.rejects(()=>action(who,{}),/permission|leads|manage locations/i);
});

test('every allowed assigned position can create normal storage in another area or team-wide',async()=>{
 for(const position of [...functionalPositions,'program_manager','product_technical_manager']){
  await db.query('update public.team_member_positions set position_key=$1 where user_id=$2',[position,users.assigned]);
  for(const classification of ['permanent','project','robot','temporary','other']){
   const {rows:[{result}]}=await action('assigned',{classification,areaId:other});
   const {rows:[location]}=await db.query('select * from public.locations where id=$1',[result.id]);
   assert.equal(location.area_id,other);assert.equal(location.classification,classification);assert.equal(location.trip_id,null);assert.equal(location.active,true);
  }
 }
 const {rows:[{result}]}=await action('assigned',{classification:'permanent',areaId:''});
 assert.equal((await db.query('select area_id from public.locations where id=$1',[result.id])).rows[0].area_id,null);
 for(const who of ['programManager','projectManager'])assert.ok((await action(who,{classification:'permanent'})).rows[0].result.id);
});
test('only normal active parents and valid fields are accepted',async()=>{
 const {rows:[{result:parent}]}=await action('assigned',{classification:'permanent',kind:'Storage',room:'Lab'});
 for(const kind of ['Storage','Side','Shelf','Bin','Drawer']){
  const {rows:[{result}]}=await action('assigned',{classification:'permanent',parentId:parent.id,kind,room:'Ignore forged room'});
  const {rows:[child]}=await db.query('select * from public.locations where id=$1',[result.id]);
  assert.equal(child.parent_id,parent.id);assert.equal(child.location_type,kind);assert.equal(child.room,'Lab');
 }
 for(const data of [{classification:'travel'},{classification:'checkout'},{kind:'System'},{name:'   '},{tripId:parent.id},{active:false},{id:parent.id},{created_by:users.mentor}])await assert.rejects(()=>action('assigned',data),/normal storage|location name/);
 await assert.rejects(()=>action('assigned',{parentId:'44180000-0000-4000-8000-000000000099'}),/active normal storage/);
 await db.query('update public.locations set active=false where id=$1',[parent.id]);
 await assert.rejects(()=>action('assigned',{parentId:parent.id}),/active normal storage/);
 await db.query('update public.areas set active=false where id=$1',[other]);
 await assert.rejects(()=>action('assigned',{areaId:other}),/active team area/);
 await db.query('update public.areas set active=true where id=$1',[other]);
});
test('revocation, deactivation and account readiness are checked again at write time',async()=>{
 const context=()=>asUser('assigned',tx=>tx.query('select public.inventory_location_creation_context() result'));
 assert.equal((await context()).rows[0].result.assigned_lead,true);
 await db.query('update public.team_member_positions set revoked_at=now() where user_id=$1',[users.assigned]);
 assert.equal((await context()).rows[0].result.assigned_lead,false);
 await assert.rejects(()=>action('assigned',{classification:'permanent'}),/leads|permission/);
 await db.query('update public.team_member_positions set revoked_at=null where user_id=$1',[users.assigned]);
 await db.query('update public.profiles set active=false where id=$1',[users.assigned]);
 await assert.rejects(()=>action('assigned',{}),/permission/);
 await db.query('update public.profiles set active=true where id=$1',[users.assigned]);
 await db.query('update auth.users set last_sign_in_at=null where id=$1',[users.assigned]);
 await assert.rejects(()=>action('assigned',{}),/leads|permission/);
 await db.query('update auth.users set last_sign_in_at=now() where id=$1',[users.assigned]);
});
test('no direct internal execution, anonymous capability read or self-assignment bypass',async()=>{
 await assert.rejects(()=>asUser('assigned',tx=>tx.query("select private.create_assigned_lead_location('{}')")),/permission/);
 await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select public.inventory_location_creation_context()');}),/permission/);
 await assert.rejects(()=>asUser('student',tx=>tx.query("insert into public.team_member_positions(user_id,position_key) values($1,'software_lead')",[users.student])),/permission/);
 await db.query("update auth.users set raw_user_meta_data=jsonb_build_object('role','lead','position','software_lead') where id=$1",[users.student]);
 await assert.rejects(()=>action('student',{classification:'permanent'}),/leads|permission/);
});

test('only the new dispatch branch is added to the existing inventory RPC',async()=>{
 const definition=(await db.query("select pg_get_functiondef('public.inventory_action(text,jsonb)'::regprocedure) definition")).rows[0].definition;
 const addition=" if p_action='create_location' and private.can_create_assigned_lead_location() then\n  return private.create_assigned_lead_location(p_data);\n end if;\n";
 assert.equal(definition.replace(addition,''),originalAction);
 const policies=(await db.query("select policyname,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='locations' order by policyname")).rows;
 assert.equal(policies.length,2);assert.deepEqual(policies.find(p=>p.policyname==='locations_write'),{policyname:'locations_write',cmd:'ALL',qual:'private.is_admin()',with_check:'private.is_admin()'});
});
test('archiving an allowlisted position removes the grant and other permissions stay unchanged',async()=>{
 await db.query("update public.team_member_positions set position_key='software_lead' where user_id=$1",[users.assigned]);
 await db.query("update public.team_positions set active=false where key='software_lead'");
 await assert.rejects(()=>action('assigned',{}),/leads|permission/);
 await db.query("update public.team_positions set active=true where key='software_lead'");
 const {rows:[{result}]}=await action('assigned',{classification:'permanent'});
 await db.query("insert into storage.objects(bucket_id,name) values('inventory-media',$1)",[`locations/${result.id}/00000000-0000-4000-8000-000000000100.png`]);
 await assert.rejects(()=>asUser('assigned',tx=>tx.query("insert into public.inventory_media(entity_type,entity_id,path,alt_text) values('locations',$1,$2,'Synthetic photo')",[result.id,`locations/${result.id}/00000000-0000-4000-8000-000000000100.png`])),/permission|row.level/);
 await assert.rejects(()=>asUser('assigned',tx=>tx.query("select public.inventory_action('create_trip','{\"name\":\"Not allowed\"}'::jsonb)")),/admins|mentors/);
 assert.equal((await db.query('select role from public.profiles where id=$1',[users.assigned])).rows[0].role,'student');
});
