import { blankItem, type Item, type Area, type Location, type Database } from '../data';
import type { InventoryEvent, UserProfile } from './types';
export type Row=Record<string,unknown>;
const str=(r:Row,k:string)=>r[k]==null?'':String(r[k]);
export const profileFromRow=(r:Row):UserProfile=>({id:str(r,'id'),displayName:str(r,'display_name'),email:str(r,'email'),role:str(r,'role') as UserProfile['role'],primaryAreaId:str(r,'primary_area_id')||null,active:r.active===true,updatedAt:str(r,'updated_at')});
export const areaFromRow=(r:Row):Area=>({id:str(r,'id'),active:r.active!==false,name:str(r,'name'),slug:str(r,'slug'),lead:str(r,'lead_name')});
export const locationFromRow=(r:Row):Location=>({id:str(r,'id'),updatedAt:str(r,'updated_at'),classification:(str(r,'classification')||'permanent') as Location['classification'],areaId:str(r,'area_id'),tripId:str(r,'trip_id'),active:r.active!==false,name:str(r,'name'),bin:str(r,'code'),parentId:str(r,'parent_id')||null,kind:(str(r,'location_type')||undefined) as Location['kind'],description:str(r,'description'),room:str(r,'room'),storage:str(r,'storage')});
export function itemFromRow(r:Row):Item{return {...blankItem(),id:str(r,'id'),name:str(r,'name'),areaId:str(r,'area_id'),category:str(r,'category'),quantity:Number(r.quantity),expectedQuantity:r.expected_quantity==null?null:Number(r.expected_quantity),minimum:Number(r.minimum_quantity??0),target:Number(r.target_quantity??0),unit:str(r,'unit'),locationId:str(r,'location_id'),slot:str(r,'slot_position'),manufacturer:str(r,'manufacturer'),partNumber:str(r,'manufacturer_part_number'),vendor:str(r,'vendor'),url:str(r,'vendor_url'),cost:Number(r.approx_unit_cost??0),notes:str(r,'notes'),lastVerified:str(r,'last_verified_at'),lastVerifiedBy:str(r,'last_verified_by'),updatedAt:str(r,'updated_at'),updatedBy:str(r,'updated_by'),legacyUpdatedBy:str(r,'legacy_updated_by'),itemType:str(r,'item_type') as Item['itemType'],ownership:str(r,'ownership') as Item['ownership'],orderStatus:str(r,'order_status') as Item['orderStatus'],trackingMode:str(r,'tracking_mode') as Item['trackingMode']};}
export const itemToRow=(i:Item):Row=>({id:i.id,name:i.name,item_type:i.itemType,ownership:i.ownership,area_id:i.areaId,category:i.category,quantity:i.quantity,expected_quantity:i.expectedQuantity,minimum_quantity:i.minimum,target_quantity:i.target,unit:i.unit,location_id:i.locationId||null,slot_position:i.slot,manufacturer:i.manufacturer,manufacturer_part_number:i.partNumber,vendor:i.vendor,vendor_url:i.url,approx_unit_cost:i.cost,notes:i.notes,last_verified_at:i.lastVerified||null,legacy_updated_by:i.legacyUpdatedBy||(!isUuid(i.updatedBy)?i.updatedBy:''),order_status:i.orderStatus||'Needs Order',tracking_mode:i.trackingMode||'quantity'});
export const eventFromRow=(r:Row):InventoryEvent=>({id:str(r,'id'),itemId:str(r,'inventory_item_id')||null,itemName:str(r,'item_name'),areaId:str(r,'area_id')||null,userId:str(r,'user_id')||null,eventType:str(r,'event_type'),quantityBefore:r.quantity_before==null?null:Number(r.quantity_before),quantityAfter:r.quantity_after==null?null:Number(r.quantity_after),changeAmount:r.change_amount==null?null:Number(r.change_amount),notes:str(r,'notes'),createdAt:str(r,'created_at')});
export const isUuid=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export async function stableId(kind:string,id:string):Promise<string>{
 if(isUuid(id))return id;
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`frc4418:${kind}:${id}`)));
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
 const h=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export const slug=(name:string)=>name.toLowerCase().replace(/\W+/g,'-').replace(/^-|-$/g,'');
export async function migrationData(source:Database,current:Database):Promise<Database>{
 const areaIds=new Map<string,string>();const locationIds=new Map<string,string>();
 for(const a of source.areas){
  const id=current.areas.find(x=>(x.slug||slug(x.name))===(a.slug||slug(a.name)))?.id??await stableId('area',a.id);
  areaIds.set(a.id,id);areaIds.set(a.slug||slug(a.name),id);
 }
 for(const l of source.locations)locationIds.set(l.id,await stableId('location',l.id));
 const areas=source.areas.map(a=>({...a,id:areaIds.get(a.id)!,slug:a.slug||slug(a.name)}));
 const locations=source.locations.map(l=>({...l,id:locationIds.get(l.id)!,parentId:l.parentId?locationIds.get(l.parentId)??l.parentId:null}));
 const items=await Promise.all(source.items.map(async i=>({...i,id:await stableId('item',i.id),areaId:areaIds.get(i.areaId)??i.areaId,locationId:locationIds.get(i.locationId)||i.locationId,legacyUpdatedBy:i.legacyUpdatedBy||i.updatedBy})));
 return {...current,areas:[...current.areas,...areas.filter(a=>!current.areas.some(x=>x.id===a.id))],locations:[...current.locations,...locations.filter(l=>!current.locations.some(x=>x.id===l.id))],items:[...current.items,...items.filter(i=>!current.items.some(x=>x.id===i.id))],categories:[...new Set([...current.categories,...source.categories,...items.map(i=>i.category)])]};
}

export const balanceFromRow=(r:Row)=>({id:str(r,'id'),itemId:str(r,'inventory_item_id'),locationId:str(r,'location_id'),quantity:Number(r.quantity),updatedAt:str(r,'updated_at'),lastVerified:str(r,'last_verified_at'),lastVerifiedBy:str(r,'last_verified_by')});
export const tripFromRow=(r:Row)=>({id:str(r,'id'),name:str(r,'name'),event:str(r,'event_name'),destination:str(r,'destination'),start:str(r,'start_date'),end:str(r,'end_date'),status:str(r,'status') as import('./logistics-model').TripStatus,notes:str(r,'notes')});
export const manifestFromRow=(r:Row)=>({ownership:str(r,'ownership'),id:str(r,'id'),tripId:str(r,'trip_id'),itemId:str(r,'inventory_item_id'),quantity:Number(r.quantity),homeLocationId:str(r,'home_location_id'),currentLocationId:str(r,'current_location_id'),status:str(r,'status') as import('./logistics-model').Manifest['status'],resolution:str(r,'resolution'),notes:str(r,'notes')});
export const movementFromRow=(r:Row)=>({id:str(r,'id'),itemId:str(r,'inventory_item_id'),itemName:str(r,'item_name'),quantity:Number(r.quantity),from:str(r,'from_location_id'),to:str(r,'to_location_id'),tripId:str(r,'trip_id'),type:str(r,'movement_type'),userId:str(r,'user_id'),note:str(r,'note'),createdAt:str(r,'created_at')});
export const mediaFromRow=(r:Row)=>({id:str(r,'id'),entityType:str(r,'entity_type') as import('./logistics-model').Media['entityType'],entityId:str(r,'entity_id'),path:str(r,'path'),alt:str(r,'alt_text'),updatedAt:str(r,'updated_at')});
