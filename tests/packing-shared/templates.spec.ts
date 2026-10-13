import {test,expect,type APIRequestContext} from '../browser-fixtures';
import {randomUUID} from 'node:crypto';
const api='http://127.0.0.1:54404';
const home='10000000-0000-4000-8000-000000000001',itemId='20000000-0000-4000-8000-000000000001';
async function login(request:APIRequestContext,role:string){const response=await request.post(api+'/auth/v1/token?grant_type=password',{data:{email:role+'@example.test',password:'test-password'}});expect(response.ok()).toBeTruthy();const session=await response.json();return {Authorization:'Bearer '+session.access_token,apikey:'test-public-key'};}
async function rpc(request:APIRequestContext,headers:Record<string,string>,fn:string,data:unknown){const response=await request.post(api+'/rest/v1/rpc/'+fn,{headers,data});const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBeTruthy();return result;}
async function rows(request:APIRequestContext,headers:Record<string,string>,table:string){const response=await request.get(api+'/rest/v1/'+table+'?select=*',{headers});expect(response.ok()).toBeTruthy();return response.json();}
test('shared HTTP contract saves and copies only plans, then uses existing packing and return workflow',async({request})=>{
 const mentor=await login(request,'mentor'),student=await login(request,'student'),readonly=await login(request,'readonly'),lead=await login(request,'lead');
 const action=(name:string,data:unknown,actor=mentor)=>rpc(request,actor,'inventory_action',{p_action:name,p_data:data});
 const packing=(name:string,data:unknown,actor=mentor)=>rpc(request,actor,'packing_template_action',{p_action:name,p_data:data});
 const prior=await action('create_trip',{name:'Shared previous event'});let locations=await rows(request,mentor,'locations');const to=locations.find((l:any)=>l.trip_id===prior.id&&l.name==='Trailer').id;
 const approved=await action('approve',{tripId:prior.id,itemId,quantity:2,from:home,to},lead);await action('trip_status',{tripId:prior.id,status:'packing'});
 await action('pack',{manifestId:approved.id,quantity:2},student);await action('return',{manifestId:approved.id,quantity:2},student);await action('trip_status',{tripId:prior.id,status:'closed'});
 const physical=await rows(request,mentor,'inventory_balances');const saved=await packing('save',{requestId:randomUUID(),sourceTripId:prior.id,name:'Shared reusable kit'});
 const templates=await rows(request,readonly,'packing_templates');expect(templates.find((t:any)=>t.id===saved.id).lines).toEqual([{itemId,quantity:2,homeLocationId:home}]);
 expect(await rows(request,mentor,'inventory_balances')).toEqual(physical);
 const target=await action('create_trip',{name:'Shared next event'});locations=await rows(request,mentor,'locations');const destinationId=locations.find((l:any)=>l.trip_id===target.id&&l.name==='Trailer').id;
 const items=await rows(request,mentor,'inventory_items'),balance=physical.find((b:any)=>b.inventory_item_id===itemId&&b.location_id===home);
 const command={requestId:randomUUID(),templateId:saved.id,tripId:target.id,reviewed:true,lines:[{itemId,quantity:2,homeLocationId:home,destinationId,itemUpdatedAt:items.find((i:any)=>i.id===itemId).updated_at,balanceUpdatedAt:balance.updated_at}]};
 const denied=await request.post(api+'/rest/v1/rpc/packing_template_action',{headers:student,data:{p_action:'approve',p_data:command}});expect(denied.status()).toBe(403);
 const result=await packing('approve',command,lead);expect(await packing('approve',command,lead)).toEqual(result);expect(await rows(request,mentor,'inventory_balances')).toEqual(physical);
 const manifest=(await rows(request,mentor,'trip_manifest_items')).filter((m:any)=>m.trip_id===target.id);expect(manifest).toHaveLength(1);expect(manifest[0].status).toBe('approved');
 await action('trip_status',{tripId:target.id,status:'packing'});await action('pack',{manifestId:result.manifestIds[0],quantity:2},student);await action('return',{manifestId:result.manifestIds[0],quantity:2},student);await action('trip_status',{tripId:target.id,status:'closed'});
 expect((await rows(request,mentor,'inventory_balances')).filter((b:any)=>b.quantity>0).map((b:any)=>[b.inventory_item_id,b.location_id,b.quantity])).toEqual(physical.filter((b:any)=>b.quantity>0).map((b:any)=>[b.inventory_item_id,b.location_id,b.quantity]));
});
