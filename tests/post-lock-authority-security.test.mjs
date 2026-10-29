import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createRoleDb,adapterSql,ids,home,destination,as,action,item} from './fixtures/admin-lead-db.mjs';
const migration=await readFile(new URL('../supabase/migrations/20261028170803_inventory_post_lock_authority.sql',import.meta.url),'utf8');
const pins=JSON.parse(await readFile(new URL('./fixtures/inventory-post-lock-pins.json',import.meta.url))).functions;
let db,baseline;
const snapshot=async d=>({functions:(await d.query("select p.oid,p.proowner,p.proacl::text,p.prosecdef,p.provolatile,p.proconfig,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by p.oid")).rows,policies:(await d.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,rows:(await d.query('select (select jsonb_agg(p order by id) from profiles p) profiles,(select jsonb_agg(i order by id) from inventory_items i) items')).rows});
before(async()=>{db=await createRoleDb();await db.exec(await adapterSql());baseline=await snapshot(db);await db.exec(migration);});after(()=>db?.close());
test('exact three full definitions change only after item locks; modes, ACLs, policies and rows remain identical',async()=>{
 const next=await snapshot(db);assert.deepEqual(next.policies,baseline.policies);assert.deepEqual(next.rows,baseline.rows);const changed=[];
 for(const f of next.functions){const old=baseline.functions.find(x=>x.oid===f.oid);assert.deepEqual({...f,definition:null},{...old,definition:null});if(f.definition!==old.definition)changed.push(f.definition);}
 assert.deepEqual(changed.sort(),pins.map(p=>p.expected_definition).sort());
 for(const p of pins){assert.ok(baseline.functions.some(f=>f.definition===p.definition));assert.equal(p.definition.split(p.anchor).length,2);assert.match(p.replacement,/for update;\n -- Re-read committed authority/);assert.match(p.replacement,/role::text in \('student','lead','admin_lead','admin','mentor'\)/);}
});
test('ordinary Student/no area and existing active roles still count, move and verify with authentic attribution',async()=>{
 assert.equal((await db.query('select primary_area_id from profiles where id=$1',[ids.student])).rows[0].primary_area_id,null);
 for(const who of ['student','lead','adminLead','mentor','admin']){const id=await item(db,who);const counted=(await as(db,who,tx=>tx.query('select change_inventory_quantity($1,1) result',[id]))).rows[0].result;assert.equal(Number(counted.item.quantity),7);assert.equal(counted.item.updated_by,ids[who]);await action(db,who,'move',{itemId:id,from:home,to:destination,quantity:1});const expected=(await db.query('select jsonb_agg(jsonb_build_object(\'id\',id,\'updated_at\',updated_at)) expected from inventory_items where location_id=$1 or id in(select inventory_item_id from inventory_balances where location_id=$1 and quantity>0)',[home])).rows[0].expected;await as(db,who,tx=>tx.query('select verify_balance_location($1,$2)',[home,JSON.stringify(expected)]));assert.equal((await db.query('select quantity::float quantity from inventory_balances where inventory_item_id=$1 and location_id=$2',[id,destination])).rows[0].quantity,1);}
});
test('Readonly and inactive remain denied for all three RPCs with no inventory or audit writes',async()=>{
 const id=await item(db);const fp=async()=>JSON.stringify((await db.query('select (select jsonb_agg(i order by id) from inventory_items i) items,(select jsonb_agg(b order by id) from inventory_balances b) balances,(select jsonb_agg(e order by id) from inventory_events e) events,(select jsonb_agg(m order by id) from inventory_movements m) movements')).rows);const original=await fp();
 for(const who of ['readonly','inactive','inactiveLead']){await assert.rejects(()=>as(db,who,tx=>tx.query('select change_inventory_quantity($1,1)',[id])),/permission/);await assert.rejects(()=>action(db,who,'move',{itemId:id,from:home,to:destination,quantity:1}),/permission/);await assert.rejects(()=>as(db,who,tx=>tx.query('select verify_balance_location($1,\'[]\')',[home])),/permission/);assert.equal(await fp(),original);}
});
test('replay and unrelated function drift fail atomically without permission changes',async()=>{
 const before=await snapshot(db);await assert.rejects(()=>db.exec(migration),/full definition drift/);await db.exec('rollback');assert.deepEqual(await snapshot(db),before);
 const d=await createRoleDb();try{await d.exec(await adapterSql());const p=pins.find(p=>p.signature.startsWith('public.verify_balance_location'));await d.exec(p.definition.replace('declare r record;','-- Unrelated synthetic drift\ndeclare r record;'));const before=await snapshot(d);await assert.rejects(()=>d.exec(migration),/full definition drift/);await d.exec('rollback');assert.deepEqual(await snapshot(d),before);}finally{await d.close();}
});
test('missing role-adapter prerequisite fails without partially replacing quantity RPC',async()=>{const d=await createRoleDb();try{const before=await snapshot(d);await assert.rejects(()=>d.exec(migration),/full definition drift/);await d.exec('rollback');assert.deepEqual(await snapshot(d),before);}finally{await d.close();}});
// Native real-lock races are required separately in Hub's shared Auth/API gate.
// PGlite is intentionally not described as evidence for multiple-connection MVCC.
