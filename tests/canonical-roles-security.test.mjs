import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRoleDb,adapterSql,sql,ids,area,other,home,destination,as,action,item} from './fixtures/admin-lead-db.mjs';
const migration=await sql('20261029190425_inventory_canonical_roles.sql');
const manifest=JSON.parse(await readFile(new URL('./fixtures/inventory-canonical-role-pins.json',import.meta.url)));const pins=manifest.functions;
const canonical=`update profiles set role='admin_lead' where role='admin';alter table profiles drop constraint profiles_role_check;alter table profiles add constraint profiles_role_check check(role in ('readonly','student','lead','admin_lead','mentor'));`;
const catalog=async db=>({functions:(await db.query("select n.nspname||'.'||p.proname name,p.proowner,p.proacl::text,p.prosecdef,p.provolatile,p.proconfig,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by p.oid")).rows,policies:(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,data:(await db.query('select (select jsonb_agg(p order by id) from profiles p) profiles,(select jsonb_agg(l order by id) from locations l) locations,(select jsonb_agg(p order by user_id) from team_member_positions p) positions')).rows});
async function setup(){const db=await createRoleDb();await db.exec(await adapterSql());await db.exec(await sql('20261028170803_inventory_post_lock_authority.sql'));await db.exec(canonical);return db;}
test('canonical Inventory migration changes only pinned functions; Mentor administration and student/Lead boundaries persist',async t=>{
 const db=await setup();try{
 const before=await catalog(db);await db.exec(migration);const after=await catalog(db);
 await t.test('exact definitions, ACLs, RLS, Storage and account/position records',async()=>{
  assert.deepEqual(after.data,before.data);
  for(const old of before.policies){const next=after.policies.find(x=>x.schemaname===old.schemaname&&x.tablename===old.tablename&&x.policyname===old.policyname);if(old.policyname==='items_delete')assert.equal(next.qual,'private.can_delete_item(area_id)');else if(['inventory_media_delete','inventory_media_update'].includes(old.policyname))assert.match(next.qual,/NOT \(EXISTS[\s\S]*inventory_media/);else assert.deepEqual(next,old);}
  for(let i=0;i<before.functions.length;i++){const old=before.functions[i],next=after.functions.find(x=>x.name===old.name);const pin=pins.find(p=>p.schema+'.'+p.name===old.name);const expectedVolatile=['private.can_manage_media','private.can_manage_media_path'].includes(old.name)?'v':old.provolatile;assert.deepEqual({...next,definition:null},{...old,provolatile:expectedVolatile,definition:null});assert.equal(next.definition,pin?.expected_definition??old.definition);if(pin)assert.equal(old.definition,pin.definition);}
 });
 await t.test('Mentor alone has global Inventory administration',async()=>{
  for(const who of ['mentor','admin','adminLead','lead','student','readonly']){
   assert.equal((await as(db,who,tx=>tx.query('select private.is_admin() allowed'))).rows[0].allowed,who==='mentor');
   if(who!=='mentor')await assert.rejects(()=>action(db,who,'create_trip',{name:'Not allowed'}),/mentor|permission/);
  }
  assert.ok((await action(db,'mentor','create_trip',{name:'Synthetic canonical trip'})).rows[0].result.id);
 });
 await t.test('Students and both leadership tiers edit item details/photos across all areas without deletion or location-photo grants',async()=>{
  await db.query('update profiles set primary_area_id=$1 where id=$2',[area,ids.admin]);
  for(const who of ['student','lead','admin','adminLead']){
   const own=await item(db,who),cross=await item(db,'mentor',other);
   await as(db,who,tx=>tx.query("update inventory_items set name='Own edit' where id=$1",[own]));
   await as(db,who,tx=>tx.query("update inventory_items set name='Cross edit',notes='All-area edit',area_id=$2 where id=$1",[cross,other]));
   await assert.rejects(()=>as(db,who,tx=>tx.query('update inventory_items set area_id=$2 where id=$1',[cross,area])),/Only a Mentor can reassign/);
   let record=(await db.query('select * from inventory_items where id=$1',[cross])).rows[0];
   await as(db,who,tx=>tx.query('select apply_inventory_changes($1)',[JSON.stringify({items:[{record:{...record,notes:'Allowed RPC metadata'},expected_updated_at:record.updated_at}]})]));
   record=(await db.query('select * from inventory_items where id=$1',[cross])).rows[0];assert.equal(record.notes,'Allowed RPC metadata');
   await assert.rejects(()=>as(db,who,tx=>tx.query('select apply_inventory_changes($1)',[JSON.stringify({items:[{record:{...record,area_id:area},expected_updated_at:record.updated_at}]})])),/Only a Mentor can reassign/);
   assert.deepEqual((await as(db,who,tx=>tx.query('delete from inventory_items where id=$1 returning id',[cross]))).rows,[]);
   const rights=(await as(db,who,tx=>tx.query("select private.can_manage_media('items',$1) own, private.can_manage_media('items',$2) other",[own,cross]))).rows[0];assert.deepEqual(rights,{own:true,other:true});
   assert.equal((await as(db,who,tx=>tx.query("select private.can_manage_media('locations',$1) allowed",[destination]))).rows[0].allowed,false);
   await action(db,who,'move',{itemId:own,from:home,to:destination,quantity:1});
  }
 });
 await t.test('Lead/Admin Lead create across areas without assignments; Student creation is denied even with a functional position',async()=>{
  for(const who of ['lead','adminLead','unassigned']){const result=await action(db,who,'create_location',{name:'Any area '+who,kind:'Box',classification:'permanent',areaId:other});assert.equal((await db.query('select area_id from locations where id=$1',[result.rows[0].result.id])).rows[0].area_id,other);}
  for(const who of ['student','assignedStudent'])await assert.rejects(()=>action(db,who,'create_location',{name:'Denied',kind:'Box',areaId:other}),/Lead.*required/);
  await as(db,'student',tx=>tx.query("insert into locations(name,code,location_type) values('Bypass','Bypass','Box')")).then(()=>assert.fail('Direct location insert must fail'),e=>assert.match(e.message,/row.level/));
 });
 await t.test('location creation preserves valid Auth account guards but needs no attendance membership',async()=>{
  for(const change of ["email_confirmed_at=null","last_sign_in_at=null","banned_until=now()+interval '1 day'"]){
   await db.query(`update auth.users set ${change} where id=$1`,[ids.lead]);
   await assert.rejects(()=>action(db,'lead','create_location',{name:'Denied invalid Auth',kind:'Box',areaId:other}),/Lead.*required/);
   await db.query("update auth.users set email_confirmed_at=now(),last_sign_in_at=now(),banned_until=null where id=$1",[ids.lead]);
  }
  await db.query("update profiles set active=false where id=$1",[ids.lead]);
  await assert.rejects(()=>action(db,'lead','create_location',{name:'Denied inactive',kind:'Box',areaId:other}),/permission|active|Lead.*required/i);
  await db.query("update profiles set active=true where id=$1",[ids.lead]);
  await action(db,'lead','create_location',{name:'No attendance prerequisite',kind:'Box',areaId:other});
 });
 await t.test('Admin Lead cross-area rename is name-only; existing assigned Student rename is preserved',async()=>{
  for(const who of ['unassigned','assignedStudent']){const row=(await db.query('select * from locations where id=$1',[destination])).rows[0];await action(db,who,'rename_location',{id:destination,name:'Renamed '+who,updatedAt:row.updated_at});const next=(await db.query('select * from locations where id=$1',[destination])).rows[0];assert.equal(next.name,'Renamed '+who);assert.equal(next.area_id,row.area_id);assert.equal(next.parent_id,row.parent_id);await assert.rejects(()=>action(db,who,'rename_location',{id:destination,name:'Bad',updatedAt:next.updated_at,areaId:area}),/only the location name/);await assert.rejects(()=>action(db,who,'configure_location',{id:destination,kind:'Shelf',classification:'permanent',updatedAt:next.updated_at}),/Only mentors/);}
 });
 await t.test('Student photo editing is entity-bound and cannot delete a referenced Storage object',async()=>{
  const own=await item(db,'mentor',other),path=`items/${own}/synthetic.png`;
  await as(db,'student',tx=>tx.query("insert into storage.objects(bucket_id,name) values('inventory-media',$1)",[path]));
  await as(db,'student',tx=>tx.query("insert into inventory_media(entity_type,entity_id,path,alt_text) values('items',$1,$2,'Student photo')",[own,path]));
  assert.deepEqual((await as(db,'student',tx=>tx.query('delete from storage.objects where name=$1 returning id',[path]))).rows,[]);
  assert.deepEqual((await as(db,'student',tx=>tx.query('update storage.objects set name=$2 where name=$1 returning name',[path,path+'.moved']))).rows,[]);
  await assert.rejects(()=>as(db,'student',tx=>tx.query("insert into storage.objects(bucket_id,name) values('inventory-media',$1)",[`locations/${destination}/denied.png`])),/row.level/);
  await as(db,'student',tx=>tx.query('delete from inventory_media where entity_id=$1',[own]));
  assert.equal((await as(db,'student',tx=>tx.query('delete from storage.objects where name=$1 returning id',[path]))).rows.length,1);
 });
 await t.test('new helpers have no anonymous or PUBLIC execute and do not grant unrestricted deletion',async()=>{
  for(const signature of manifest.new_functions){const row=(await db.query("select has_function_privilege('anon',$1,'EXECUTE') anon, has_function_privilege('authenticated',$1,'EXECUTE') auth",[signature])).rows[0];assert.deepEqual(row,{anon:false,auth:true});}
  assert.equal((await as(db,'student',tx=>tx.query('select private.can_delete_item($1) allowed',[area]))).rows[0].allowed,false);
 });
 await t.test('legacy role cannot be assigned; Readonly and inactive cannot write',async()=>{
  await assert.rejects(()=>db.query("update profiles set role='admin' where id=$1",[ids.admin]),/check constraint/);
  for(const who of ['readonly','inactive'])await assert.rejects(()=>item(db,who),/row.level|cannot create|cannot change/);
 });
 await t.test('replay and late drift fail atomically',async()=>{
  const state=await catalog(db);await assert.rejects(()=>db.exec(migration),/function\/ACL drift/);await db.exec('rollback');assert.deepEqual(await catalog(db),state);
 });
 }finally{await db.close();}
});
test('canonical migration refuses legacy six-role prerequisite without changes',async()=>{const db=await createRoleDb();try{await db.exec(await adapterSql());await db.exec(await sql('20261028170803_inventory_post_lock_authority.sql'));const before=await catalog(db);await assert.rejects(()=>db.exec(migration),/five-role CHECK/);await db.exec('rollback');assert.deepEqual(await catalog(db),before);}finally{await db.close();}});
