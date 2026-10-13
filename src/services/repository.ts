import {localWrite} from './local-inventory-write';
import {validateRestock,type RestockPolicy} from './setup-model';
import {preparePhoto} from './media';
import {localAction,syncLocalBalances} from './logistics-local';
import {locationItems,type InventoryAction,type ActionData,type Media} from './logistics-model';
import { createId } from '../utils/id';
import { repository as local, verifyDrawer as markDrawer, type Database, type Item } from '../data';
import { supabase } from './supabase';
import { balanceFromRow,tripFromRow,manifestFromRow,movementFromRow,mediaFromRow,areaFromRow,eventFromRow,itemFromRow,itemToRow,locationFromRow,migrationData,profileFromRow,slug,type Row } from './mapping';
import { demoProfile,type InventoryEvent,type InventoryRepository,type UserProfile } from './types';
const changed=(a:unknown,b:unknown)=>JSON.stringify(a)!==JSON.stringify(b);
type LocalWithHistory=Database&{events?:InventoryEvent[]};
export class LocalStorageInventoryRepository implements InventoryRepository {
 readonly mode='demo' as const;
 async load(){return localWrite(()=>{const db=local.load(); let changed=false; for(const l of db.locations){if(!l.labelCode){l.labelCode='L-'+createId().replaceAll('-','').slice(0,12).toUpperCase();changed=true;}}if(changed)local.save(db);return {...db,setupAvailable:true};});}
 async setupItem(item:Item,policy:RestockPolicy,minimum:number,target:number){return localWrite(async()=>{const error=validateRestock(policy,minimum,target);if(error)throw new Error(error);const before=local.load(),current=before.items.find(i=>i.id===item.id);if(!current||current.updatedAt!==item.updatedAt)throw new Error('This item changed. Review the latest settings.');await this.applyUnlocked(before,{...before,items:before.items.map(i=>i.id===item.id?{...i,restockPolicy:policy,minimum,target,updatedAt:new Date().toISOString()}:i)});});}
 async apply(before:Database,next:Database){return localWrite(()=>this.applyUnlocked(before,next));}
 private async applyUnlocked(before:Database,next:Database){
  const current=local.existing();const savedState=(value:Database)=>({...value,setupAvailable:undefined});if(current&&changed(savedState(current),savedState(before)))throw new Error('Workspace changed. Refresh before saving.');
  const events=[...((before as LocalWithHistory).events??[])];
  for(const i of next.items){const old=before.items.find(x=>x.id===i.id);if(!old||changed(old,i))events.push(this.event(i,old?i.quantity!==old.quantity?'quantity_changed':'item_updated':'item_created',old?.quantity??null));}
  local.save({...syncLocalBalances(before,next),events:events.slice(-500)} as LocalWithHistory);
 }
 private event(i:Item,type:string,before:number|null):InventoryEvent{return {id:createId(),itemId:i.id,itemName:i.name,areaId:i.areaId,userId:'local-demo',eventType:type,quantityBefore:before,quantityAfter:i.quantity,changeAmount:before===null?null:i.quantity-before,notes:'',createdAt:new Date().toISOString()};}
 async quantity(item:Item,change:{delta?:number;quantity?:number;verify?:boolean}){return localWrite(()=>this.quantityUnlocked(item,change));}
 private async quantityUnlocked(item:Item,change:{delta?:number;quantity?:number;verify?:boolean}){
  const db=local.load();
  if(db.logistics&&item.balanceLocationId){
   const before=db.logistics.balances.find(b=>b.itemId===item.id&&b.locationId===item.balanceLocationId)?.quantity??0;
   const next=localAction(db,'adjust',{itemId:item.id,from:item.balanceLocationId,quantity:change.delta===undefined?change.quantity!:Math.max(0,before+change.delta),updatedAt:item.updatedAt,verify:change.verify??false});local.save(next);
   return {before,item:next.items.find(i=>i.id===item.id)!,locationQuantity:next.logistics!.balances.find(b=>b.itemId===item.id&&b.locationId===item.balanceLocationId)!.quantity};
  }
  const current=db.items.find(i=>i.id===item.id);if(!current)throw new Error('This item no longer exists.');
  if(change.delta===undefined&&current.updatedAt!==item.updatedAt)throw new Error('This item changed. Review the latest count and try again.');
  const quantity=change.delta===undefined?change.quantity!:Math.max(0,current.quantity+change.delta);
  if(!Number.isFinite(quantity)||quantity<0)throw new Error('Enter a nonnegative quantity.');
  const now=new Date().toISOString();const saved={...current,quantity,updatedAt:now,...(change.verify?{lastVerified:now,lastVerifiedBy:'local-demo'}:{})};
  const events=[...((db as LocalWithHistory).events??[]),this.event(saved,change.verify?'item_verified':'quantity_changed',current.quantity)];
  local.save({...syncLocalBalances(db,{...db,items:db.items.map(i=>i.id===item.id?saved:i)}),events:events.slice(-500)} as LocalWithHistory);return {before:current.quantity,item:saved};
 }
 async verifyDrawer(db:Database,id:string){return localWrite(()=>this.verifyDrawerUnlocked(db,id));}
 private async verifyDrawerUnlocked(db:Database,id:string){
  if(db.logistics){const current=local.load();const items=locationItems(current,id),expected=locationItems(db,id);if(items.length!==expected.length||items.some(i=>!expected.some(e=>e.id===i.id&&e.updatedAt===i.updatedAt)))throw new Error('Location contents changed');const now=new Date().toISOString();for(const item of items){const b=current.logistics!.balances.find(b=>b.itemId===item.id&&b.locationId===id);if(b){b.lastVerified=now;b.lastVerifiedBy='local-demo';}const i=current.items.find(i=>i.id===item.id)!;i.updatedAt=now;if(i.locationId===id)i.lastVerified=now;}local.save(current);return;}
  const current=local.load();const expected=db.items.filter(i=>i.locationId===id);const actual=current.items.filter(i=>i.locationId===id);
  if(expected.length!==actual.length||actual.some(i=>!expected.some(x=>x.id===i.id&&x.updatedAt===i.updatedAt)))throw new Error('Drawer contents changed. Review the latest counts.');
  const next=markDrawer(current,id);const events=[...((current as LocalWithHistory).events??[]),...next.items.filter(i=>i.locationId===id).map(i=>this.event(i,'drawer_verified',i.quantity))];
  local.save({...next,events:events.slice(-500)} as LocalWithHistory);
 }
 async action(action:InventoryAction|'enable',data:ActionData){await localWrite(()=>{local.save(localAction(local.load(),action,data));});}
 async photoUrl(path:string){return path;}
 async savePhoto(){throw new Error('Photo uploads require the shared Supabase workspace.');}
 async deletePhoto(){throw new Error('Photo uploads require the shared Supabase workspace.');}
 subscribe(){return ()=>{};}
 async profiles(){return [demoProfile];}
 async history(itemId?:string,areaId?:string){return ((local.load() as LocalWithHistory).events??[]).filter(e=>(!itemId||e.itemId===itemId)&&(!areaId||e.areaId===areaId)).reverse().slice(0,30);}
 async importData(source:Database,current:Database){await this.apply(current,source);}
}
export class SupabaseInventoryRepository implements InventoryRepository {
 readonly mode='supabase' as const;
 private client(){if(!supabase)throw new Error('Supabase is not configured.');return supabase;}
 private async rows(table:string):Promise<Row[]>{
  const result:Row[]=[];let page=0;
  while(true){const {data,error}=await this.client().from(table).select('*').order(table==='categories'?'name':'id').range(page*1000,page*1000+999);if(error)throw error;result.push(...(data as Row[]));if(data.length<1000)return result;page++;}
 }
 private features: boolean|undefined;
 private setupFeatures:boolean|undefined;
 async load():Promise<Database>{
  if(this.features===undefined){const {data,error}=await this.client().rpc('inventory_features');if(error&&error.code!=='PGRST202'&&error.code!=='42883')throw error;this.features=!error&&data>=4;}
  if(this.setupFeatures===undefined){const {data,error}=await this.client().rpc('inventory_setup_features');if(error&&error.code!=='PGRST202'&&error.code!=='42883')throw error;this.setupFeatures=!error&&data===1;}
  const [items,areas,locations,categories]=await Promise.all(['inventory_items','areas','locations','categories'].map(t=>this.rows(t)));
  const db:Database={setupAvailable:this.setupFeatures,version:1,items:items.map(itemFromRow),areas:areas.map(areaFromRow),locations:locations.map(locationFromRow),categories:[...new Set([...categories.map(r=>String(r.name)),...items.map(r=>String(r.category))])]};
  if(this.features){const [balances,trips,manifest,movements,media]=await Promise.all(['inventory_balances','trips','trip_manifest_items','inventory_movements','inventory_media'].map(t=>this.rows(t)));db.logistics={balances:balances.map(balanceFromRow),trips:trips.map(tripFromRow),manifest:manifest.map(manifestFromRow),movements:movements.map(movementFromRow),media:media.map(mediaFromRow)};const totals=new Map<string,number>();for(const b of db.logistics.balances)totals.set(b.itemId,(totals.get(b.itemId)||0)+b.quantity);db.items=db.items.map(i=>({...i,quantity:totals.get(i.id)||0}));}
  return db;
 }
 async setupItem(item:Item,policy:RestockPolicy,minimum:number,target:number){const error=validateRestock(policy,minimum,target);if(error)throw new Error(error);const {error:failure}=await this.client().rpc('setup_inventory_item',{p_id:item.id,p_expected_updated_at:item.updatedAt,p_policy:policy,p_minimum:minimum,p_target:target});if(failure)throw failure;}
 async apply(before:Database,next:Database){
  const areas=next.areas.filter(a=>changed(before.areas.find(x=>x.id===a.id),a)).map(a=>({record:{id:a.id,slug:a.slug||slug(a.name),name:a.name,lead_name:a.lead}}));
  const pending=next.locations.filter(l=>changed(before.locations.find(x=>x.id===l.id),l));const ordered:typeof pending=[];const seen=new Set(before.locations.map(l=>l.id));
  while(pending.length){const index=pending.findIndex(l=>!l.parentId||seen.has(l.parentId));if(index<0)throw new Error('A location parent is missing or forms a cycle.');const [l]=pending.splice(index,1);ordered.push(l);seen.add(l.id);}
  const locations=ordered.map(l=>({record:{id:l.id,classification:l.classification||'permanent',area_id:l.areaId||null,name:l.name||l.bin||l.storage,code:l.bin,parent_id:l.parentId||null,location_type:l.kind||null,description:l.description||'',room:l.room,storage:l.storage}}));
  const items=next.items.filter(i=>changed(before.items.find(x=>x.id===i.id),i)).map(i=>({record:itemToRow(i),expected_updated_at:before.items.find(x=>x.id===i.id)?.updatedAt||null}));
  const deleted_items=before.items.filter(i=>!next.items.some(x=>x.id===i.id)).map(i=>({id:i.id,updated_at:i.updatedAt}));
  const categories=next.categories.filter(c=>!before.categories.includes(c));
  if(!areas.length&&!locations.length&&!items.length&&!deleted_items.length&&!categories.length)return;
  const {error}=await this.client().rpc('apply_inventory_changes',{p_changes:{areas,locations,items,deleted_items,categories}});if(error)throw error;
 }
 async quantity(item:Item,change:{delta?:number;quantity?:number;verify?:boolean}){
  if(this.features&&item.balanceLocationId){
   const {data,error}=await this.client().rpc('inventory_action',{p_action:'adjust',p_data:{itemId:item.id,from:item.balanceLocationId,quantity:change.quantity??0,delta:change.delta??null,updatedAt:item.updatedAt,verify:change.verify??false}});if(error)throw error;
   return {before:Number(data.before),item:itemFromRow(data.item),locationQuantity:Number(data.quantity)};
  }
  const {data,error}=await this.client().rpc('change_inventory_quantity',{p_id:item.id,p_delta:change.delta??null,p_quantity:change.quantity??null,p_expected_updated_at:item.updatedAt,p_verify:change.verify??false});if(error)throw error;
  const result=data as {before:number;item:Row};return {before:Number(result.before),item:itemFromRow(result.item)};
 }
 async verifyDrawer(db:Database,id:string){if(db.logistics){const {error}=await this.client().rpc('verify_balance_location',{p_location:id,p_expected:locationItems(db,id).map(i=>({id:i.id,updated_at:i.updatedAt}))});if(error)throw error;return;}const {error}=await this.client().rpc('verify_inventory_drawer',{p_location_id:id,p_expected:db.items.filter(i=>i.locationId===id).map(i=>({id:i.id,updated_at:i.updatedAt}))});if(error)throw error;}
 subscribe(onChange:()=>void,onStatus:(message:string)=>void){
  let timer:ReturnType<typeof setTimeout>|undefined;const notify=()=>{clearTimeout(timer);timer=setTimeout(onChange,150);};
  const channel=this.client().channel(`inventory-${createId()}`);
  for(const table of ['inventory_items','locations','inventory_events','profiles','areas',...(this.features?['inventory_balances','inventory_movements','trip_manifest_items','trips','inventory_media']:[])])channel.on('postgres_changes',{event:'*',schema:'public',table},notify);
  channel.subscribe(status=>{onStatus(status==='SUBSCRIBED'?'':'Live updates are reconnecting. Data also refreshes every 30 seconds.');if(status==='SUBSCRIBED')notify();});
  const fallback=setInterval(onChange,30000);const focus=()=>onChange();window.addEventListener('focus',focus);
  return ()=>{clearTimeout(timer);clearInterval(fallback);window.removeEventListener('focus',focus);void this.client().removeChannel(channel);};
 }
 async action(action:InventoryAction|'enable',data:ActionData){if(action==='enable')throw new Error('Ask a mentor to apply migrations 004 and 005.');const {error}=await this.client().rpc('inventory_action',{p_action:action,p_data:data});if(error)throw error;}
 async photoUrl(path:string){const {data,error}=await this.client().storage.from('inventory-media').createSignedUrl(path,3600);if(error)throw error;return data.signedUrl;}
 async savePhoto(kind:Media['entityType'],id:string,file:File,alt:string,previous?:Media){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5242880)throw new Error('Choose a JPG, PNG or WebP image up to 5 MB.');
  file=await preparePhoto(file);
  const path=`${kind}/${id}/${createId()}.${file.type==='image/jpeg'?'jpg':file.type.split('/')[1]}`;
  const bucket=this.client().storage.from('inventory-media');const upload=await bucket.upload(path,await file.arrayBuffer(),{contentType:file.type,upsert:false});if(upload.error)throw upload.error;
  const record={entity_type:kind,entity_id:id,path,alt_text:alt};
  const response=previous?await this.client().from('inventory_media').update(record).eq('id',previous.id).eq('updated_at',previous.updatedAt).select('id'):await this.client().from('inventory_media').insert(record).select('id');
  if(response.error||!response.data?.length){await bucket.remove([path]);throw response.error||new Error('Photo changed on another device. Refresh before replacing it.');}
  if(previous){const result=await bucket.remove([previous.path]);if(result.error)throw new Error('Photo saved. The old file could not be cleaned up; a mentor can remove it from Storage.');}
 }
 async deletePhoto(photo:Media){const {data,error}=await this.client().from('inventory_media').delete().eq('id',photo.id).eq('updated_at',photo.updatedAt).select('id');if(error)throw error;if(!data?.length)throw new Error('Photo changed. Refresh first.');const removed=await this.client().storage.from('inventory-media').remove([photo.path]);if(removed.error)throw new Error('Photo reference removed, but Storage cleanup failed. Ask a mentor to remove the old file.');}
 async profiles(){return (await this.rows('profiles')).map(profileFromRow);}
 async history(itemId?:string,areaId?:string){let query=this.client().from('inventory_events').select('*').order('created_at',{ascending:false}).limit(30);if(itemId)query=query.eq('inventory_item_id',itemId);if(areaId)query=query.eq('area_id',areaId);const {data,error}=await query;if(error)throw error;return (data as Row[]).map(eventFromRow);}
 async importData(source:Database,current:Database){await this.apply(current,await migrationData(source,current));}
}
export const inventoryRepository:InventoryRepository=supabase?new SupabaseInventoryRepository():new LocalStorageInventoryRepository();
