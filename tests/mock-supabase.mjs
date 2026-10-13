// Local test contract, not a Supabase emulator or production server.
// Uses the actual migration SQL/RLS and mimics only the Auth/PostgREST/Realtime calls this app uses.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {WebSocketServer} from 'ws';
const db=new PGlite();const logistics=process.env.TEST_LOGISTICS==='1';const checkouts=process.env.TEST_TOOL_CHECKOUTS==='1';const files=new Map();
const ids={mentor:'00000000-0000-4000-8000-000000000001',student:'00000000-0000-4000-8000-000000000002',lead:'00000000-0000-4000-8000-000000000003',readonly:'00000000-0000-4000-8000-000000000004',inactive:'00000000-0000-4000-8000-000000000005'};
const area='44180000-0000-4000-8000-000000000001',power='44180000-0000-4000-8000-000000000002';
const drawer='10000000-0000-4000-8000-000000000001',item='20000000-0000-4000-8000-000000000001';
await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
if(logistics)await db.exec("create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;");
for(const [role,id]of Object.entries(ids))await db.query('insert into auth.users(id,email) values($1,$2)',[id,role+'@example.test']);
for(const file of ['001_initial_schema.sql','002_rls_policies.sql','003_operations_and_seed.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
for(const [role,id]of Object.entries(ids))await db.query('update public.profiles set role=$1,display_name=$2,primary_area_id=$3,active=$4 where id=$5',[role==='inactive'?'student':role,role[0].toUpperCase()+role.slice(1),role==='lead'?area:null,role!=='inactive',id]);
const asUser=(id,fn)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);return fn(tx);});
await asUser(ids.mentor,async tx=>{
 await tx.query("insert into public.locations(id,name,code,location_type) values($1,'TA-01','TA-01','Drawer')",[drawer]);
 await tx.query("insert into public.categories(name) values('Tools')");
 await tx.query("insert into public.inventory_items(id,name,area_id,category,item_type,ownership,quantity,expected_quantity,minimum_quantity,target_quantity,location_id) values($1,'5/32\" Allen wrench',$2,'Tools','Tool','Shared / School',4,4,2,6,$3),('20000000-0000-4000-8000-000000000002','Power tool',$4,'Tools','Tool','FRC 4418',2,2,1,3,$3)",[item,area,drawer,power]);
});
if(logistics)for(const file of ['004_balances_travel_media.sql','005_private_inventory_media.sql','20261012232840_inventory_setup_location_labels.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
if(process.env.TEST_PACKING==='1')await db.exec(await readFile(new URL('../supabase/migrations/20261012232702_packing_templates.sql',import.meta.url),'utf8'));
if(checkouts)await db.exec(await readFile(new URL('../supabase/migrations/20261012232741_tool_checkouts.sql',import.meta.url),'utf8'));
const jwt=id=>Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})).toString('base64url')+'.test-signature';
const user=id=>({id,email:Object.keys(ids).find(k=>ids[k]===id)+'@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:new Date().toISOString()});
const session=id=>({access_token:jwt(id),refresh_token:'refresh-'+id,expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:user(id)});
const identity=req=>{try{return JSON.parse(Buffer.from(req.headers.authorization.split(' ')[1].split('.')[1],'base64url').toString()).sub;}catch{return null;}};
const clients=new Map();
const broadcast=()=>{for(const [socket,info]of clients)if(socket.readyState===1)socket.send(JSON.stringify([info.joinRef,null,info.topic,'postgres_changes',{ids:info.changes.map(c=>c.id),data:{schema:'public',table:'inventory_items',type:'UPDATE',commit_timestamp:new Date().toISOString(),columns:[{name:'id',type:'uuid'}],record:{id:item},old_record:{}}}]));};
const server=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,PUT,DELETE,OPTIONS');res.setHeader('Content-Type','application/json');
 const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);const input=bytes.length&&req.headers['content-type']?.includes('application/json')?JSON.parse(bytes.toString()):{};
 const url=new URL(req.url,'http://127.0.0.1:54329');
 if(url.pathname==='/health'){send(200,{ok:true});return;}
 if(url.pathname==='/auth/v1/token'){
  const role=input.email?.split('@')[0];const id=url.searchParams.get('grant_type')==='refresh_token'?input.refresh_token?.replace('refresh-',''):ids[role];
  if(!id||input.password&&input.password!=='test-password'){send(400,{error:'invalid_grant',error_description:'Invalid login credentials',msg:'Invalid login credentials'});return;}send(200,session(id));return;
 }
 if(url.pathname==='/auth/v1/recover'){send(200,{});return;}
 if(url.pathname.startsWith('/storage/v1/object/sign/inventory-media/')&&req.method==='GET'){const path=decodeURIComponent(url.pathname.replace('/storage/v1/object/sign/inventory-media/',''));const file=files.get(path);if(!file){send(404,{message:'Not found'});return;}res.setHeader('Content-Type',file.type);res.end(file.bytes);return;}
 const id=identity(req);if(!id){send(401,{message:'Authentication required'});return;}
 if(url.pathname==='/auth/v1/user'){send(200,user(id));return;}
 if(url.pathname==='/auth/v1/logout'){send(200,{});return;}
 try{
  if(logistics&&url.pathname.startsWith('/storage/v1/object/')){
   const path=decodeURIComponent(url.pathname.replace(/^\/storage\/v1\/object\/(sign\/)?inventory-media\/?/,''));
   if(url.pathname.includes('/sign/')){const r=await asUser(id,tx=>tx.query("select name from storage.objects where bucket_id='inventory-media' and name=$1",[path]));if(!r.rows.length)throw new Error('Photo not found');send(200,{signedURL:'/object/sign/inventory-media/'+path+'?token=test-only'});return;}
   if(req.method==='POST'){await asUser(id,tx=>tx.query("insert into storage.objects(bucket_id,name) values('inventory-media',$1)",[path]));files.set(path,{bytes,type:req.headers['content-type']});send(200,{Key:'inventory-media/'+path});return;}
   if(req.method==='DELETE'){for(const name of input.prefixes??[]){await asUser(id,tx=>tx.query("delete from storage.objects where bucket_id='inventory-media' and name=$1",[name]));files.delete(name);}send(200,[]);return;}
  }
  if(url.pathname.startsWith('/rest/v1/rpc/')){
   const fn=url.pathname.split('/').at(-1);let result;
   if(fn==='inventory_features'){send(logistics?200:404,logistics?4:{code:'PGRST202',message:'V1 fixture has no logistics migration'});return;}
   if(fn==='inventory_setup_features'){send(logistics?200:404,logistics?1:{code:'PGRST202',message:'V1 fixture has no setup migration'});return;}
   if(fn==='tool_checkout_features'){send(checkouts?200:404,checkouts?true:{code:'PGRST202',message:'Fixture has no tool checkout migration'});return;}
   if(fn==='tool_checkout_action')result=await asUser(id,tx=>tx.query('select public.tool_checkout_action($1,$2) as result',[input.p_action,JSON.stringify(input.p_data)]));
   else if(fn==='setup_inventory_item')result=await asUser(id,tx=>tx.query('select public.setup_inventory_item($1,$2,$3,$4,$5) as result',[input.p_id,input.p_expected_updated_at,input.p_policy,input.p_minimum,input.p_target]));
   else if(fn==='change_inventory_quantity')result=await asUser(id,tx=>tx.query('select public.change_inventory_quantity($1,$2,$3,$4,$5) as result',[input.p_id,input.p_delta,input.p_quantity,input.p_expected_updated_at,input.p_verify]));
   else if(fn==='packing_template_action')result=await asUser(id,tx=>tx.query('select public.packing_template_action($1,$2) as result',[input.p_action,JSON.stringify(input.p_data)]));
   else if(fn==='inventory_action')result=await asUser(id,tx=>tx.query('select public.inventory_action($1,$2) as result',[input.p_action,JSON.stringify(input.p_data)]));
   else if(fn==='verify_balance_location')result=await asUser(id,tx=>tx.query('select public.verify_balance_location($1,$2) as result',[input.p_location,JSON.stringify(input.p_expected)]));
   else if(fn==='verify_inventory_drawer')result=await asUser(id,tx=>tx.query('select public.verify_inventory_drawer($1,$2) as result',[input.p_location_id,JSON.stringify(input.p_expected)]));
   else if(fn==='apply_inventory_changes')result=await asUser(id,tx=>tx.query('select public.apply_inventory_changes($1) as result',[JSON.stringify(input.p_changes)]));
   else throw new Error('Unknown RPC');
   send(200,result.rows[0]?.result??null);broadcast();return;
  }
  const table=url.pathname.split('/').at(-1);if(!['profiles','inventory_items','inventory_events','areas','locations','categories','inventory_balances','inventory_movements','trip_manifest_items','trips','inventory_media','packing_templates',...(checkouts?['tool_loans']:[])].includes(table))throw new Error('Unknown table');
  const values=[],clauses=[];for(const [key,val]of url.searchParams)if(['id','updated_at','inventory_item_id','area_id','entity_id','trip_id'].includes(key)&&val.startsWith('eq.')){values.push(val.slice(3));clauses.push(`${key}=$${values.length}`);}
  let sql;
  if(table==='inventory_media'&&req.method==='POST'){
   sql='insert into public.inventory_media(entity_type,entity_id,path,alt_text) values($1,$2,$3,$4) returning *';values.push(input.entity_type,input.entity_id,input.path,input.alt_text);
  }else if(table==='inventory_media'&&req.method==='DELETE'){
   sql=`delete from public.inventory_media ${clauses.length?'where '+clauses.join(' and '):''} returning *`;
  }else if(req.method==='PATCH'&&['profiles','inventory_media'].includes(table)){
   const sets=[];for(const key of (table==='profiles'?['display_name','role','primary_area_id','active']:['path','alt_text','entity_type','entity_id']))if(key in input){values.push(input[key]);sets.push(`${key}=$${values.length}`);}
   sql=`update public.${table} set ${sets.join(',')} ${clauses.length?'where '+clauses.join(' and '):''} returning *`;
  }else{
   const order=url.searchParams.get('order')?.startsWith('created_at')?'created_at desc':table==='categories'?'name':'id';
   sql=`select * from public.${table} ${clauses.length?'where '+clauses.join(' and '):''} order by ${order} limit ${Math.min(Number(url.searchParams.get('limit')??1000),1000)} offset ${Number(url.searchParams.get('offset')??0)}`;
  }
  const result=await asUser(id,tx=>tx.query(sql,values));
  if(req.headers.accept?.includes('vnd.pgrst.object')){if(result.rows.length!==1){send(406,{message:'Profile not found'});return;}send(200,result.rows[0]);}
  else send(200,result.rows);
  if(req.method==='PATCH')broadcast();
 }catch(e){send(e.code==='42501'?403:409,{message:e.message,code:e.code??'ERROR'});}
});
const ws=new WebSocketServer({server});
ws.on('connection',socket=>socket.on('message',raw=>{
 const [join_ref,ref,topic,event,payload]=JSON.parse(raw.toString());const message={join_ref,ref,topic,event,payload};
 if(message.event==='phx_join'){
  const changes=(message.payload.config?.postgres_changes??[]).map((c,n)=>({...c,id:n+1}));clients.set(socket,{topic:message.topic,changes,joinRef:message.join_ref});
  socket.send(JSON.stringify([message.join_ref,message.ref,message.topic,'phx_reply',{status:'ok',response:{postgres_changes:changes}}]));
 }else if(message.event==='heartbeat')socket.send(JSON.stringify([message.join_ref,message.ref,'phoenix','phx_reply',{status:'ok',response:{}}]));
 else if(message.event==='phx_leave'){clients.delete(socket);socket.send(JSON.stringify([message.join_ref,message.ref,message.topic,'phx_reply',{status:'ok',response:{}}]));}
}));
server.listen(Number(process.env.TEST_SUPABASE_PORT||process.env.TEST_PORT||54329),'127.0.0.1',()=>console.log('Local Supabase contract fixture ready'));
