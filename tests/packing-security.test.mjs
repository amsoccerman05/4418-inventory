import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
const db=new PGlite();const users={mentor:'00000000-0000-4000-8000-000000000001',student:'00000000-0000-4000-8000-000000000002',lead:'00000000-0000-4000-8000-000000000003',readonly:'00000000-0000-4000-8000-000000000004',admin:'00000000-0000-4000-8000-000000000005'};
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
 for(const f of ['004_balances_travel_media.sql','005_private_inventory_media.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261013234533_packing_templates.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
const packing=(who,name,data)=>asUser(who,tx=>tx.query('select public.packing_template_action($1,$2) as result',[name,JSON.stringify(data)]));
const createTrip=async name=>{
 const id=(await action('mentor','create_trip',{name})).rows[0].result.id;
 const to=(await scalar("select id from public.locations where trip_id=$1 and name='Trailer'",[id])).id;
 return {id,to};
};
const save=async sourceTripId=>(await packing('mentor','save',{requestId:randomUUID(),name:'Regional kit',sourceTripId})).rows[0].result.id;
const line=async(itemId=drill,quantity=1,to)=>({itemId,quantity,homeLocationId:home,destinationId:to,itemUpdatedAt:(await scalar('select updated_at::text from public.inventory_items where id=$1',[itemId])).updated_at,balanceUpdatedAt:(await scalar('select updated_at::text from public.inventory_balances where inventory_item_id=$1 and location_id=$2',[itemId,home])).updated_at});
const manifestCount=async id=>(await scalar('select count(*)::int as n from public.trip_manifest_items where trip_id=$1',[id])).n;
let source,template;
test('immutable planned kit survives split pack/return; copies no physical state',async()=>{
 source=await createTrip('Previous competition');
 const mid=(await action('lead','approve',{tripId:source.id,itemId:drill,from:home,to:source.to,quantity:2})).rows[0].result.id;
 await action('mentor','trip_status',{tripId:source.id,status:'packing'});
 await action('student','pack',{manifestId:mid,quantity:2});
 await action('student','return',{manifestId:mid,quantity:1});
 await action('student','return',{manifestId:mid,quantity:1});
 await action('mentor','trip_status',{tripId:source.id,status:'closed'});
 const physical=await counts(drill),before=await scalar('select count(*)::int n from public.inventory_movements');
 template=await save(source.id);
 const saved=await scalar('select * from public.packing_templates where id=$1',[template]);
 assert.deepEqual(saved.lines,[{itemId:drill,quantity:2,homeLocationId:home}]);
 assert.equal(saved.created_by,users.mentor);assert.deepEqual(await counts(drill),physical);
 assert.deepEqual(await scalar('select count(*)::int n from public.inventory_movements'),before);
 await assert.rejects(()=>asUser('mentor',tx=>tx.query("update public.packing_templates set lines='[]'")),/permission/);
 await assert.rejects(()=>asUser('lead',tx=>tx.query('delete from public.packing_templates')),/permission/);
});
test('readonly may read, students/readonly/inactive/anon cannot save or approve',async()=>{
 for(const who of ['readonly','student','lead','mentor','admin'])assert.equal((await asUser(who,tx=>tx.query('select * from public.packing_templates'))).rows.length,1);
 for(const who of ['readonly','student'])for(const op of ['save','approve'])await assert.rejects(()=>packing(who,op,{requestId:randomUUID(),name:'Forbidden',sourceTripId:source.id}),/lead, admin or mentor/);
 await db.query('update public.profiles set active=false where id=$1',[users.lead]);
 await assert.rejects(()=>packing('lead','save',{requestId:randomUUID(),name:'Forbidden',sourceTripId:source.id}),/lead, admin or mentor/);
 assert.equal((await asUser('lead',tx=>tx.query('select * from public.packing_templates'))).rows.length,0);
 await db.query('update public.profiles set active=true where id=$1',[users.lead]);
 await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select public.packing_template_action($1,$2)',['save','{}']);}),/permission/);
 await assert.rejects(()=>asUser('mentor',tx=>tx.query("insert into private.packing_template_requests(actor_id,request_id,action,payload,result) values($1,$2,'save','{}','{}')",[users.mentor,randomUUID()])),/permission/);
 assert.equal((await scalar("select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='packing_template_action'")).prosecdef,false);
});
test('reviewed approval is atomic, idempotent, attributed and leaves counts unchanged',async()=>{
 const target=await createTrip('Next competition'),physical=await counts(drill);
 const data={requestId:randomUUID(),templateId:template,tripId:target.id,lines:[await line(drill,1,target.to)],reviewed:true};
 const first=(await packing('lead','approve',data)).rows[0].result;
 assert.equal(first.manifestIds.length,1);
 assert.deepEqual((await packing('lead','approve',data)).rows[0].result,first);
 assert.deepEqual(await counts(drill),physical);assert.equal(await manifestCount(target.id),1);
 const rows=(await db.query('select * from public.trip_manifest_items where trip_id=$1',[target.id])).rows;
 assert.equal(rows[0].status,'approved');assert.equal(rows[0].current_location_id,target.to);assert.equal(rows[0].resolution,'');
 await assert.rejects(()=>packing('lead','approve',{...data,lines:[{...data.lines[0],quantity:2}]}),/different input/);
 const event=await scalar("select * from public.inventory_movements where trip_id=$1 and note like '%Reviewed packing plan%'",[target.id]);assert.equal(event.user_id,users.lead);assert.equal(Number(event.quantity),0);
 await assert.rejects(()=>action('student','pack',{manifestId:first.manifestIds[0],quantity:1}),/Start packing/);
 await action('mentor','resolve',{manifestId:first.manifestIds[0],quantity:1,note:'Fixture cleanup'});
});
test('copy requires closed previous trip, valid review and active target phase',async()=>{
 const target=await createTrip('Copy review');const data={requestId:randomUUID(),sourceTripId:source.id,tripId:target.id,lines:[await line(drill,1,target.to)],reviewed:true};
 await assert.rejects(()=>packing('mentor','approve',{...data,reviewed:false}),/Review/);
 await assert.rejects(()=>packing('mentor','approve',{...data,sourceTripId:target.id}),/Only a closed/);
 await assert.rejects(()=>packing('mentor','approve',{...data,templateId:template}),/Choose one/);
 await assert.rejects(()=>packing('mentor','approve',{...data,lines:[{...data.lines[0],itemId:motor}]}),/source plan/);
 const result=(await packing('mentor','approve',data)).rows[0].result;assert.equal(result.manifestIds.length,1);
 await action('mentor','resolve',{manifestId:result.manifestIds[0],quantity:1,note:'Fixture cleanup'});
 await action('mentor','trip_status',{tripId:target.id,status:'in_transit'});
 await assert.rejects(()=>packing('mentor','approve',{...data,requestId:randomUUID()}),/planning or packing/);
});
test('rejects stale, malformed, unavailable, duplicate, cross-trip and partially invalid lines with rollback',async()=>{
 const target=await createTrip('Availability review'),foreign=await createTrip('Wrong destination');
 const original=await line(drill,1,target.to);const base={requestId:randomUUID(),templateId:template,tripId:target.id,lines:[original],reviewed:true};
 const before=await scalar('select count(*)::int n from public.inventory_movements');
 const mutations=[{...original,quantity:0},{...original,quantity:-1},{...original,quantity:'NaN'},{...original,quantity:3},{...original,itemUpdatedAt:'2000-01-01'},{...original,balanceUpdatedAt:''},{...original,homeLocationId:source.to},{...original,destinationId:foreign.to}];
 for(const bad of mutations)await assert.rejects(()=>packing('mentor','approve',{...base,lines:[bad]}));
 await assert.rejects(()=>packing('mentor','approve',{...base,lines:[original,{...original,destinationId:foreign.to}]}),/destination/);
 await assert.rejects(()=>packing('mentor','approve',{...base,lines:[{...original,quantity:2},{...original,quantity:1}]}),/Not enough/);
 assert.equal(await manifestCount(target.id),0);assert.deepEqual(await scalar('select count(*)::int n from public.inventory_movements'),before);
 const mid=(await action('mentor','approve',{tripId:foreign.id,itemId:drill,from:home,to:foreign.to,quantity:2})).rows[0].result.id;
 await assert.rejects(()=>packing('mentor','approve',base),/Not enough/);
 await action('mentor','resolve',{manifestId:mid,quantity:2,note:'Fixture cleanup'});
 await action('student','move',{itemId:drill,from:home,to:project,quantity:1});
 await assert.rejects(()=>packing('mentor','approve',base),/Availability changed/);
 await action('student','move',{itemId:drill,from:project,to:home,quantity:1});
});
test('same-operation concurrent retries return one committed save receipt',async()=>{
 const data={requestId:randomUUID(),name:'Repeated save',sourceTripId:source.id};
 const results=await Promise.all([packing('mentor','save',data),packing('mentor','save',data)]);
 assert.equal(results[0].rows[0].result.id,results[1].rows[0].result.id);
 assert.equal((await scalar("select count(*)::int n from public.packing_templates where name='Repeated save'")).n,1);
});
test('admin behavior and actor-bound receipts preserve existing role boundaries',async()=>{
 const requestId=randomUUID(),data={requestId,name:'Actor-scoped kit',sourceTripId:source.id};
 const admin=(await packing('admin','save',data)).rows[0].result.id;
 const mentor=(await packing('mentor','save',data)).rows[0].result.id;
 assert.notEqual(admin,mentor);assert.equal((await packing('admin','save',data)).rows[0].result.id,admin);
 assert.equal((await scalar('select created_by from public.packing_templates where id=$1',[admin])).created_by,users.admin);
});
test('stale review of inactive home and cancelled prior trip cannot become approval',async()=>{
 const target=await createTrip('Inactive home review'),prior=await createTrip('Cancelled empty event');
 const data={requestId:randomUUID(),templateId:template,tripId:target.id,reviewed:true,lines:[await line(drill,1,target.to)]};
 await db.query('alter table public.locations disable trigger guard_location_v2');
 await db.query('update public.locations set active=false where id=$1',[home]);
 await assert.rejects(()=>packing('mentor','approve',data),/active non-travel/);
 await db.query('update public.locations set active=true where id=$1',[home]);
 await db.query('alter table public.locations enable trigger guard_location_v2');
 await action('mentor','trip_status',{tripId:prior.id,status:'cancelled'});
 await assert.rejects(()=>packing('mentor','approve',{...data,templateId:undefined,sourceTripId:prior.id}),/Only a closed/);
 assert.equal(await manifestCount(target.id),0);
});
test('external reservation hook rejects cumulative lines before any approval',async()=>{
 const target=await createTrip('Reservation preflight');
 await db.exec("create or replace function private.packing_external_reserved(p_item uuid,p_location uuid) returns numeric language sql stable security invoker set search_path='' as $$select 1::numeric$$;");
 try{
  const reviewed=await line(drill,1,target.to),data={requestId:randomUUID(),templateId:template,tripId:target.id,reviewed:true,lines:[reviewed,reviewed]};
  await assert.rejects(()=>packing('mentor','approve',data),/Not enough/);
  assert.equal(await manifestCount(target.id),0);
  const accepted=(await packing('mentor','approve',{...data,lines:[reviewed]})).rows[0].result;
  assert.equal(accepted.manifestIds.length,1);
  await action('mentor','resolve',{manifestId:accepted.manifestIds[0],quantity:1,note:'Fixture cleanup'});
 }finally{await db.exec("create or replace function private.packing_external_reserved(p_item uuid,p_location uuid) returns numeric language sql stable security invoker set search_path='' as $$select 0::numeric$$;");}
});
