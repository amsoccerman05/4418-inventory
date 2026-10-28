import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
const db=new PGlite();
const users={mentor:'00000000-0000-4000-8000-000000000001',student:'00000000-0000-4000-8000-000000000002',lead:'00000000-0000-4000-8000-000000000003',readonly:'00000000-0000-4000-8000-000000000004',inactive:'00000000-0000-4000-8000-000000000005',outsider:'00000000-0000-4000-8000-000000000006'};
const area='44180000-0000-4000-8000-000000000001',other='44180000-0000-4000-8000-000000000002';
const drawer='10000000-0000-4000-8000-000000000001',item='20000000-0000-4000-8000-000000000001',otherItem='20000000-0000-4000-8000-000000000002';
const asUser=(who,fn)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[users[who]]);return fn(tx);});
before(async()=>{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
 for(const [role,id] of Object.entries(users))await db.query('insert into auth.users(id,email) values($1,$2)',[id,role+'@example.test']);
 for(const path of ['001_initial_schema.sql','002_rls_policies.sql','003_operations_and_seed.sql','20261021021658_student_item_creation.sql','20261028020953_lead_item_creation.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+path,import.meta.url),'utf8'));
 for(const [role,id] of Object.entries(users).filter(([role])=>role!=='outsider'))await db.query('update public.profiles set role=$1,primary_area_id=$2,active=$3 where id=$4',[role==='inactive'?'student':role,role==='lead'?area:null,role!=='inactive',id]);
 await db.query('delete from public.profiles where id=$1',[users.outsider]);
 await asUser('mentor',async tx=>{
  await tx.query("insert into public.locations(id,name,code,location_type) values($1,'TA-01','TA-01','Drawer')",[drawer]);
  await tx.query("insert into public.inventory_items(id,name,area_id,category,quantity,expected_quantity,target_quantity,location_id,item_type) values($1,'5/32 Allen wrench',$2,'Tools',4,4,6,$3,'Tool'),($4,'Other area item',$5,'Tools',2,2,3,$3,'Tool')",[item,area,drawer,otherItem,other]);
 });
});
after(()=>db.close());
test('student atomic deltas record actual before/after and authenticated actor',async()=>{
 await asUser('student',tx=>tx.query('select public.change_inventory_quantity($1,-1)',[item]));
 await asUser('student',tx=>tx.query('select public.change_inventory_quantity($1,-1)',[item]));
 const {rows}=await asUser('mentor',tx=>tx.query("select quantity_before,quantity_after,user_id from public.inventory_events where event_type='quantity_changed' order by created_at"));
 assert.equal(Number(rows[0].quantity_before),4);assert.equal(Number(rows[1].quantity_after),2);assert.equal(rows[1].user_id,users.student);
});
test('student cannot alter metadata via direct table API or spoof attribution',async()=>{
 await assert.rejects(()=>asUser('student',tx=>tx.query('update public.inventory_items set target_quantity=100 where id=$1',[item])),/metadata/);
 await asUser('student',tx=>tx.query('update public.inventory_items set quantity=3,updated_by=$1 where id=$2',[users.mentor,item]));
 const {rows}=await db.query('select updated_by from public.inventory_items where id=$1',[item]);assert.equal(rows[0].updated_by,users.student);
 await assert.rejects(()=>asUser('student',tx=>tx.query("insert into public.areas(slug,name) values('injected','Injected')")),/row.level|permission/);
 const changed=await asUser('student',tx=>tx.query("update public.profiles set role='mentor' where id=$1 returning id",[users.student]));assert.equal(changed.rows.length,0);
});
test('lead metadata permissions enforce both original and destination area',async()=>{
 await asUser('lead',tx=>tx.query('update public.inventory_items set target_quantity=7 where id=$1',[item]));
 await assert.rejects(()=>asUser('lead',tx=>tx.query('update public.inventory_items set target_quantity=8 where id=$1',[otherItem])),/metadata/);
 await assert.rejects(()=>asUser('lead',tx=>tx.query('update public.inventory_items set area_id=$1 where id=$2',[other,item])),/metadata/);
});
test('readonly and inactive accounts cannot mutate, inactive cannot read inventory',async()=>{
 for(const who of ['readonly','inactive'])await assert.rejects(()=>asUser(who,tx=>tx.query('select public.change_inventory_quantity($1,-1)',[item])),/permission/);
 const result=await asUser('readonly',tx=>tx.query('update public.inventory_items set quantity=99 returning id'));assert.equal(result.rows.length,0);
 const hidden=await asUser('inactive',tx=>tx.query('select * from public.inventory_items'));assert.equal(hidden.rows.length,0);
});
test('stale absolute updates and stale drawer audits fail atomically',async()=>{
 await assert.rejects(()=>asUser('student',tx=>tx.query("select public.change_inventory_quantity($1,null,50,'2000-01-01')",[item])),/changed/);
 await assert.rejects(()=>asUser('student',tx=>tx.query("select public.verify_inventory_drawer($1,'[]')",[drawer])),/changed/);
 const snapshot=await asUser('student',tx=>tx.query('select id,updated_at::text from public.inventory_items where location_id=$1',[drawer]));
 await asUser('student',tx=>tx.query('select public.verify_inventory_drawer($1,$2)',[drawer,JSON.stringify(snapshot.rows)]));
 const events=await db.query("select * from public.inventory_events where event_type='drawer_verified'");assert.equal(events.rows.length,2);assert.ok(events.rows.every(e=>e.user_id===users.student));
});
test('event log cannot be forged; hierarchy cycles rejected; final mentor protected',async()=>{
 await assert.rejects(()=>asUser('mentor',tx=>tx.query("insert into public.inventory_events(item_name,event_type) values('Fake','item_verified')")),/permission/);
 await assert.rejects(()=>asUser('mentor',tx=>tx.query('update public.locations set parent_id=id where id=$1',[drawer])),/contain itself/);
 await assert.rejects(()=>asUser('mentor',tx=>tx.query('update public.profiles set active=false where id=$1',[users.mentor])),/at least one/);
});
test('anonymous users have no table access',async()=>{
 await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select * from public.inventory_items');}),/permission/);
});

// Use transactions that roll back successful fixture writes so existing audit assertions stay isolated.
const rollback=async(who,fn)=>{await assert.rejects(()=>asUser(who,async tx=>{await fn(tx);throw new Error('fixture rollback');}),/^Error: fixture rollback$/);};
test('active student can create through direct SQL and patch RPC without editing or deleting',async()=>{
 await rollback('student',async tx=>{
  const {rows:[created]}=await tx.query("insert into public.inventory_items(name,area_id,category,quantity,created_by,updated_by) values('Synthetic student part',$1,'Tools',3,$2,$2) returning *",[other,users.mentor]);
  assert.equal(created.created_by,users.student);assert.equal(created.updated_by,users.student);
  const events=await tx.query("select user_id from public.inventory_events where inventory_item_id=$1 and event_type='item_created'",[created.id]);assert.equal(events.rows[0].user_id,users.student);
  const record={...created,id:'20000000-0000-4000-8000-000000000099',name:'Synthetic RPC part'};
  await tx.query('select public.apply_inventory_changes($1)',[JSON.stringify({items:[{record}]})]);
  assert.equal((await tx.query('select created_by from public.inventory_items where id=$1',[record.id])).rows[0].created_by,users.student);
  assert.equal((await tx.query('delete from public.inventory_items where id=$1 returning id',[created.id])).rows.length,0);
 });
 await assert.rejects(()=>asUser('student',tx=>tx.query("update public.inventory_items set name='Forbidden' where id=$1",[item])),/metadata/);
});
test('creation denies readonly, inactive, non-member and anonymous identities',async()=>{
 const record={...(await db.query('select * from public.inventory_items where id=$1',[item])).rows[0],id:'20000000-0000-4000-8000-000000000097'};
 for(const who of ['readonly','inactive','outsider'])await assert.rejects(()=>asUser(who,tx=>tx.query('select public.apply_inventory_changes($1)',[JSON.stringify({items:[{record}]})])),/cannot create|row.level|permission/);
 for(const who of ['readonly','inactive','outsider'])await assert.rejects(()=>asUser(who,tx=>tx.query("insert into public.inventory_items(name,area_id,category) values('Forbidden',$1,'Tools')",[area])),/cannot create|row.level|permission/);
 await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query("insert into public.inventory_items(name,area_id,category) values('Forbidden',$1,'Tools')",[area]);}),/permission/);
});
test('lead can create in any area without expanding metadata or deletion permissions',async()=>{
 for(const areaId of [area,other])await rollback('lead',async tx=>{
  const {rows:[created]}=await tx.query("insert into public.inventory_items(name,area_id,category) values('Synthetic lead part',$1,'Tools') returning *",[areaId]);
  assert.equal(created.created_by,users.lead);
  const removed=await tx.query('delete from public.inventory_items where id=$1 returning id',[created.id]);
  assert.equal(removed.rows.length,areaId===area?1:0);
 });
 await assert.rejects(()=>asUser('lead',tx=>tx.query("update public.inventory_items set name='Forbidden' where id=$1",[otherItem])),/metadata/);
});
