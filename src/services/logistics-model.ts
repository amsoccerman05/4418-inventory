import type {ToolLoan,ToolOperation} from './tool-checkouts-model';
import type {Database, Item} from '../data';
import type {PackingState} from './packing-model';
export type LocationClass='permanent'|'project'|'robot'|'travel'|'temporary'|'checkout'|'other';
export interface Balance {id:string;itemId:string;locationId:string;quantity:number;updatedAt:string;lastVerified:string;lastVerifiedBy?:string}
export const tripStatuses=['planning','packing','in_transit','at_event','returning','closed','cancelled'] as const;
export type TripStatus=typeof tripStatuses[number];
export interface Trip {id:string;name:string;event:string;destination:string;start:string;end:string;status:TripStatus;notes:string}
export interface Manifest {ownership:string;id:string;tripId:string;itemId:string;quantity:number;homeLocationId:string;currentLocationId:string;status:'approved'|'packed'|'returned'|'resolved';resolution:string;notes:string}
export interface Movement {id:string;itemId:string;itemName:string;quantity:number;from:string;to:string;tripId:string;type:string;userId:string;note:string;createdAt:string}
export interface Media {id:string;entityType:'items'|'locations';entityId:string;path:string;alt:string;updatedAt:string}
export interface Logistics {packing?:PackingState;toolLoans?:ToolLoan[];toolOperations?:ToolOperation[];balances:Balance[];trips:Trip[];manifest:Manifest[];movements:Movement[];media:Media[]}
export type InventoryAction='move'|'adjust'|'create_trip'|'trip_status'|'approve'|'pack'|'internal'|'return'|'resolve'|'create_location';
export type ActionData=Record<string,string|number|boolean|null>;
export const title=(s:string)=>s.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
export const balanceAt=(db:Database,itemId:string,locationId:string)=>db.logistics?.balances.find(b=>b.itemId===itemId&&b.locationId===locationId)?.quantity??0;
export function atLocation(db:Database,item:Item,locationId:string):Item {
 if(!db.logistics)return item;
 const balance=db.logistics.balances.find(b=>b.itemId===item.id&&b.locationId===locationId);
 const quantity=balance?.quantity??0;
 return {...item,quantity,totalQuantity:item.quantity,homeLocationId:item.locationId,locationId,balanceLocationId:locationId,expectedQuantity:item.locationId===locationId?item.expectedQuantity:null,assignedElsewhere:Math.max(0,item.quantity-quantity),lastVerified:balance?.lastVerified??'',lastVerifiedBy:balance?.lastVerifiedBy};
}
export function locationItems(db:Database,id:string){return db.items.filter(i=>i.locationId===id||balanceAt(db,i.id,id)>0).map(i=>atLocation(db,i,id));}
export const unaccounted=(i:Item)=>Math.max(0,(i.expectedQuantity??0)-i.quantity-(i.assignedElsewhere??0));
export const incomplete=(i:Item)=>i.itemType==='Tool'&&i.expectedQuantity!==null&&i.quantity<i.expectedQuantity;
export const activeTrip=(t:Trip)=>!['closed','cancelled'].includes(t.status);
