import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';

// Synthetic records only: never use the live team roster or Auth identities.
const db=new PGlite();
const users=Object.fromEntries(['mentor','admin','lead','student','assigned','readonly','inactive','pending','banned','unconfirmed','inactiveMember','revoked','archivedPosition','programManager','projectManager','coach','otherPosition'].map((key,index)=>[key,`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`]));
const area='44180000-0000-4000-8000-000000000001',other='44180000-0000-4000-8000-000000000002';
const reservedLocation='44180000-0000-4000-8000-000000000099';
const functionalPositions=['business_lead','cad_lead','communications_lead','fabrication_lead','finance_lead','operations_lead','power_lead','software_lead','strategy_lead'];
const asUser=(who,fn)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[users[who]??who]);return fn(tx);});
const create=(who,data)=>asUser(who,tx=>tx.query("select public.inventory_action('create_location',$1) result",[JSON.stringify({name:'Synthetic new location',classification:'project',areaId:area,...data})]));
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
 await db.exec(await readFile(new URL('../supabase/migrations/20261028011601_assigned_student_lead_location_creation.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261028020701_normal_location_types_and_rename.sql',import.meta.url),'utf8'));
});
after(()=>db.close());

const row=async id=>(await db.query('select to_jsonb(l) record from public.locations l where id=$1',[id])).rows[0]?.record;
const newLocation=async(who='assigned',data={})=>row((await create(who,{classification:'permanent',...data})).rows[0].result.id);
const rename=(who,location,data={})=>asUser(who,tx=>tx.query("select public.inventory_action('rename_location',$1) result",[JSON.stringify({id:location.id,name:'Synthetic renamed location',updatedAt:location.updated_at,...data})]));
const errorCode=expected=>error=>error?.code===expected;
const unchangedExceptNameAndTimestamp=(before,after)=>{
 const omit=({name,updated_at,...rest})=>rest;
 assert.deepEqual(omit(after),omit(before));
};
const accountingSnapshot=async()=>{
 const tables=['inventory_items','inventory_balances','inventory_events','inventory_movements','inventory_media','trips','trip_manifest_items'];
 return Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') records from public.${table} t`)).rows[0].records])));
};

test('all eleven current assigned student positions may rename another area location',async()=>{
 for(const position of [...functionalPositions,'program_manager','product_technical_manager']){
  await db.query('update public.team_member_positions set position_key=$1 where user_id=$2',[position,users.assigned]);
  const location=await newLocation('mentor',{areaId:other});
  const name=`Synthetic ${position} renamed`;
  const result=(await rename('assigned',location,{name})).rows[0].result;
  assert.deepEqual(result,{id:location.id});
  const saved=await row(location.id);assert.equal(saved.name,name);unchangedExceptNameAndTimestamp(location,saved);
 }
});

test('mentor and admin can rename normal locations; legacy account lead alone cannot',async()=>{
 for(const who of ['mentor','admin']){
  const location=await newLocation('mentor');
  await rename(who,location,{name:`Synthetic ${who} rename`});
  assert.equal((await row(location.id)).name,`Synthetic ${who} rename`);
 }
 const location=await newLocation('mentor');
 await assert.rejects(()=>rename('lead',location),errorCode('42501'));
 assert.deepEqual(await row(location.id),location);
 // Existing account-lead project creation was not removed by the rename migration.
 assert.ok((await create('lead',{areaId:other})).rows[0].result.id);
});

test('ordinary, readonly, inactive, pending, revoked, banned and invalid-position identities cannot rename',async()=>{
 const location=await newLocation('mentor');
 for(const who of ['student','readonly','inactive','pending','banned','unconfirmed','inactiveMember','revoked','archivedPosition','coach','otherPosition']){
  await assert.rejects(()=>rename(who,location),errorCode('42501'));
  assert.deepEqual(await row(location.id),location);
 }
 const outsider='00000000-0000-4000-8000-999999999999';
 await assert.rejects(()=>rename(outsider,location),errorCode('42501'));
 await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query("select public.inventory_action('rename_location',$1)",[JSON.stringify({id:location.id,name:'Forbidden',updatedAt:location.updated_at})]);}),errorCode('42501'));
});

test('revocation and archiving an actual allowlisted position remove rename at write time',async()=>{
 await db.query("update public.team_member_positions set position_key='software_lead' where user_id=$1",[users.assigned]);
 const location=await newLocation('mentor');
 await db.query("update public.team_positions set active=false where key='software_lead'");
 await assert.rejects(()=>rename('assigned',location),errorCode('42501'));
 await db.query("update public.team_positions set active=true where key='software_lead'");
 await db.query('update public.team_member_positions set revoked_at=now() where user_id=$1',[users.assigned]);
 await assert.rejects(()=>rename('assigned',location),errorCode('42501'));
 await db.query('update public.team_member_positions set revoked_at=null where user_id=$1',[users.assigned]);
 await rename('assigned',location);assert.equal((await row(location.id)).name,'Synthetic renamed location');
});

test('renaming changes only name and concurrency timestamp, preserving accounting and references',async()=>{
 const parent=await newLocation('mentor',{name:'Synthetic parent toolbox',kind:'Toolbox',room:'Lab'});
 const location=await newLocation('assigned',{name:'Synthetic original drawer',parentId:parent.id,kind:'Drawer',areaId:other,note:'Leave instructions unchanged'});
 const child=await newLocation('mentor',{name:'Synthetic sibling',parentId:parent.id,kind:'Shelf'});
 await asUser('mentor',tx=>tx.query("insert into public.inventory_items(name,area_id,category,quantity,expected_quantity,location_id) values('Synthetic tool',$1,'Tools',7,9,$2)",[other,location.id]));
 const accounting=await accountingSnapshot();
 const originalParent=await row(parent.id),originalChild=await row(child.id);
 await rename('assigned',location,{name:'  Synthetic renamed drawer  '});
 const saved=await row(location.id);assert.equal(saved.name,'Synthetic renamed drawer');assert.notEqual(saved.updated_at,location.updated_at);
 unchangedExceptNameAndTimestamp(location,saved);
 assert.deepEqual(await row(parent.id),originalParent);assert.deepEqual(await row(child.id),originalChild);
 assert.deepEqual(await accountingSnapshot(),accounting);
 assert.equal(saved.code,'Synthetic original drawer');assert.equal(saved.storage,'Synthetic parent toolbox');
});

test('extra fields cannot turn rename into a move, type edit, actor spoof, archive or ID replacement',async()=>{
 const location=await newLocation('mentor');
 for(const key of ['parent_id','parentId','location_type','kind','area_id','areaId','code','storage','room','classification','trip_id','tripId','active','created_by','created_at','updated_at','description']){
  await assert.rejects(()=>rename('assigned',location,{[key]:key==='active'?false:'forged'}),errorCode('22023'));
  assert.deepEqual(await row(location.id),location);
 }
 await assert.rejects(()=>rename('assigned',location,{id:'00000000-0000-4000-8000-999999999999'}),errorCode('42501'));
 assert.deepEqual(await row(location.id),location);
});

test('stale and missing row versions reject, and an unchanged name is idempotent',async()=>{
 const location=await newLocation('mentor');
 await rename('assigned',location,{name:location.name});assert.deepEqual(await row(location.id),location);
 for(const updatedAt of [null,'', '2000-01-01T00:00:00Z'])await assert.rejects(()=>rename('assigned',location,{updatedAt}),errorCode('40001'));
 await rename('assigned',location,{name:'Synthetic first writer'});
 const saved=await row(location.id);
 await assert.rejects(()=>rename('assigned',location,{name:'Synthetic stale overwrite'}),errorCode('40001'));
 assert.deepEqual(await row(location.id),saved);
 await rename('assigned',saved,{name:'Synthetic fresh writer'});assert.equal((await row(location.id)).name,'Synthetic fresh writer');
});

test('empty, whitespace-only and oversized names are rejected without a partial mutation',async()=>{
 const location=await newLocation('mentor');
 for(const name of ['',null,'     ','x'.repeat(201),' \t\n ']){
  await assert.rejects(()=>rename('assigned',location,{name}),errorCode('22023'));
  assert.deepEqual(await row(location.id),location);
 }
});

test('reserved, travel, checkout and inactive locations or ancestors cannot be renamed',async()=>{
 const trip=(await db.query("insert into public.trips(name) values('Synthetic trip') returning id")).rows[0].id;
 const parents=[];
 for(const [classification,active,tripId] of [['travel',true,trip],['checkout',true,null],['permanent',false,null]]){
  const parent=(await db.query('insert into public.locations(name,location_type,classification,active,trip_id) values($1,$2,$3,$4,$5) returning id',[`Synthetic forbidden ${classification} ${active}`,'Storage',classification,active,tripId])).rows[0].id;
  parents.push(parent);
 }
 parents.push(reservedLocation);
 for(const parentId of parents){
  const child=(await db.query("insert into public.locations(name,parent_id,location_type,classification) values('Synthetic descendant',$1,'Box','permanent') returning id",[parentId])).rows[0].id;
  for(const target of [await row(parentId),await row(child)]){
   for(const who of ['assigned','mentor','admin'])await assert.rejects(()=>rename(who,target),errorCode('42501'));
   assert.deepEqual(await row(target.id),target);
  }
 }
});

test('assigned students still cannot update or delete directly or call the internal rename helper',async()=>{
 const location=await newLocation('mentor');
 for(const who of ['assigned','lead','student']){
  const updated=await asUser(who,tx=>tx.query("update public.locations set name='Direct forbidden edit' where id=$1 returning id",[location.id]));assert.equal(updated.rows.length,0);
  const deleted=await asUser(who,tx=>tx.query('delete from public.locations where id=$1 returning id',[location.id]));assert.equal(deleted.rows.length,0);
  await assert.rejects(()=>asUser(who,tx=>tx.query('select private.rename_inventory_location($1)',[JSON.stringify({id:location.id,name:'Internal bypass',updatedAt:location.updated_at})])),errorCode('42501'));
  assert.deepEqual(await row(location.id),location);
 }
 const policies=(await db.query("select policyname,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='locations' order by policyname")).rows;
 assert.equal(policies.length,2);assert.deepEqual(policies.find(p=>p.policyname==='locations_write'),{policyname:'locations_write',cmd:'ALL',qual:'private.is_admin()',with_check:'private.is_admin()'});
});

test('Box, Toolbox and Closet are creatable structural types and valid normal parents',async()=>{
 for(const who of ['assigned','mentor','admin']){
  for(const kind of ['Box','Toolbox','Closet']){
   const parent=await newLocation(who,{kind,name:`Synthetic ${who} ${kind}`,areaId:other,room:'Normal room'});
   assert.equal(parent.location_type,kind);assert.equal(parent.classification,'permanent');assert.equal(parent.area_id,other);
   const child=await newLocation(who,{kind:'Box',parentId:parent.id,name:'Synthetic nested box'});
   assert.equal(child.parent_id,parent.id);assert.equal(child.location_type,'Box');assert.equal(child.room,'Normal room');
   await rename(who,parent,{name:`Synthetic renamed ${kind}`});assert.equal((await row(parent.id)).name,`Synthetic renamed ${kind}`);
  }
 }
 const legacy=(await create('lead',{name:'Synthetic legacy lead project',kind:'Box'})).rows[0].result;
 assert.equal((await row(legacy.id)).location_type,'Storage'); // Legacy account-lead branch is unchanged.
});

const configure=(who,location,data={})=>asUser(who,tx=>tx.query("select public.inventory_action('configure_location',$1) result",[JSON.stringify({id:location.id,kind:'Toolbox',classification:'permanent',updatedAt:location.updated_at,...data})]));
const unchangedExceptStorageSettings=(before,after)=>{
 const omit=({location_type,classification,updated_at,...rest})=>rest;
 assert.deepEqual(omit(after),omit(before));
};

test('only admin and mentor can convert project storage use and type without changing inventory',async()=>{
 for(const [who,kind] of [['admin','Toolbox'],['mentor','Closet']]){
  const parent=await newLocation('mentor',{name:'Synthetic configuration parent',kind:'Storage',room:'Lab'});
  const location=await newLocation('mentor',{name:'Synthetic project location',kind:'Box',classification:'project',parentId:parent.id,areaId:other,note:'Preserve instructions'});
  await asUser('mentor',tx=>tx.query("insert into public.inventory_items(name,area_id,category,quantity,location_id) values('Synthetic configured-location part',$1,'Parts',12,$2)",[other,location.id]));
  const accounting=await accountingSnapshot(),originalParent=await row(parent.id);
  const result=(await configure(who,location,{kind,classification:'permanent'})).rows[0].result;
  assert.deepEqual(result,{id:location.id});const saved=await row(location.id);
  assert.equal(saved.location_type,kind);assert.equal(saved.classification,'permanent');assert.notEqual(saved.updated_at,location.updated_at);
  unchangedExceptStorageSettings(location,saved);assert.deepEqual(await row(parent.id),originalParent);assert.deepEqual(await accountingSnapshot(),accounting);
 }
});

test('assigned positions, legacy account lead and all non-admin accounts cannot configure',async()=>{
 const location=await newLocation('mentor',{classification:'project'});
 for(const who of ['assigned','programManager','projectManager','lead','student','readonly','inactive','pending','banned','unconfirmed','inactiveMember','revoked','archivedPosition','coach','otherPosition']){
  await assert.rejects(()=>configure(who,location),errorCode('42501'));assert.deepEqual(await row(location.id),location);
 }
 await db.query('update public.profiles set active=false where id=$1',[users.admin]);
 await assert.rejects(()=>configure('admin',location),errorCode('42501'));
 await db.query('update public.profiles set active=true where id=$1',[users.admin]);
});

test('configuration rejects stale versions and ignores no-op changes without rewriting the timestamp',async()=>{
 const location=await newLocation('mentor',{kind:'Toolbox',classification:'project'});
 await configure('admin',location,{kind:'Toolbox',classification:'project'});assert.deepEqual(await row(location.id),location);
 await assert.rejects(()=>configure('admin',location,{updatedAt:null}),errorCode('40001'));
 await configure('admin',location,{kind:'Closet'});const saved=await row(location.id);
 await assert.rejects(()=>configure('mentor',location,{classification:'other'}),errorCode('40001'));
 assert.deepEqual(await row(location.id),saved);
 await configure('mentor',saved,{classification:'temporary'});assert.equal((await row(location.id)).classification,'temporary');
});

test('configuration cannot mutate other fields or create reserved types and classifications',async()=>{
 const location=await newLocation('mentor',{classification:'project'});
 for(const data of [{kind:'System'},{kind:null},{classification:'travel'},{classification:'checkout'},{classification:null},{name:'Forbidden rename'},{parentId:null},{areaId:other},{code:'FORGED'},{tripId:null},{active:false},{description:'Forbidden edit'}]){
  await assert.rejects(()=>configure('admin',location,data),errorCode('22023'));
  assert.deepEqual(await row(location.id),location);
 }
 for(const who of ['assigned','mentor','admin'])await assert.rejects(()=>asUser(who,tx=>tx.query('select private.configure_inventory_location($1)',[JSON.stringify({id:location.id,kind:'Storage',classification:'permanent',updatedAt:location.updated_at})])),errorCode('42501'));
});

test('a parent with children cannot become Drawer or Bin and its children remain linked',async()=>{
 const parent=await newLocation('mentor',{kind:'Toolbox',classification:'project'});
 const child=await newLocation('mentor',{parentId:parent.id,kind:'Drawer'});
 for(const kind of ['Drawer','Bin']){
  await assert.rejects(()=>configure('admin',parent,{kind}),errorCode('22023'));
  assert.deepEqual(await row(parent.id),parent);assert.deepEqual(await row(child.id),child);
 }
 await configure('admin',parent,{kind:'Closet'});assert.equal((await row(parent.id)).location_type,'Closet');assert.equal((await row(child.id)).parent_id,parent.id);
 const leaf=await newLocation('mentor',{kind:'Box'});
 await configure('mentor',leaf,{kind:'Bin'});assert.equal((await row(leaf.id)).location_type,'Bin');
});

test('admin configuration cannot modify reserved, inactive, travel or checkout ancestry',async()=>{
 const targets=[await row(reservedLocation)];
 for(const [classification,active] of [['travel',true],['checkout',true],['permanent',false]]){
  const id=(await db.query('insert into public.locations(name,location_type,classification,active) values($1,$2,$3,$4) returning id',[`Synthetic config excluded ${classification} ${active}`,'Storage',classification,active])).rows[0].id;
  targets.push(await row(id));
 }
 for(const parent of targets){
  const child=(await db.query("insert into public.locations(name,parent_id,location_type,classification) values('Synthetic config excluded descendant',$1,'Box','project') returning id",[parent.id])).rows[0].id;
  for(const location of [parent,await row(child)]){
   for(const who of ['admin','mentor'])await assert.rejects(()=>configure(who,location),errorCode('42501'));
   assert.deepEqual(await row(location.id),location);
  }
 }
});
