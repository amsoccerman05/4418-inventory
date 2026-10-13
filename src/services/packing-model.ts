import type {Database} from '../data';
import type {UserProfile} from './types';
import {loanQuantityAt} from './tool-checkouts-model';

/** Planned quantities only. No physical state or historical transactions belong here. */
export interface PackingLine {itemId:string;quantity:number;homeLocationId:string}
export interface PackingTemplate {id:string;name:string;lines:PackingLine[];sourceTripId:string|null;createdAt:string;createdBy:string}
export interface ReviewedPackingLine extends PackingLine {destinationId:string;itemUpdatedAt:string;balanceUpdatedAt:string}
export interface PackingSource {templateId?:string;sourceTripId?:string}
export interface PackingCommand extends PackingSource {requestId:string;name?:string;tripId?:string;lines?:ReviewedPackingLine[];reviewed?:boolean}
export interface PackingReceipt {id?:string;manifestIds?:string[]}
export interface PackingState {templates:PackingTemplate[];requests:{id:string;actor:string;payload:string;result:PackingReceipt}[]}
export const canManagePacking=(p:UserProfile)=>p.active&&['lead','admin','mentor'].includes(p.role);
export function plannedTripLines(db:Database,tripId:string):PackingLine[]{
 const lines=new Map<string,PackingLine>();
 for(const m of db.logistics?.manifest.filter(m=>m.tripId===tripId)??[]){
  const key=m.itemId+':'+m.homeLocationId,old=lines.get(key);
  if(old)old.quantity+=m.quantity;else lines.set(key,{itemId:m.itemId,quantity:m.quantity,homeLocationId:m.homeLocationId});
 }
 return [...lines.values()].sort((a,b)=>a.itemId.localeCompare(b.itemId)||a.homeLocationId.localeCompare(b.homeLocationId));
}
export function availableForPacking(db:Database,itemId:string,homeLocationId:string){
 const have=db.logistics?.balances.find(b=>b.itemId===itemId&&b.locationId===homeLocationId)?.quantity??0;
 const planned=(db.logistics?.manifest??[]).filter(m=>m.itemId===itemId&&m.homeLocationId===homeLocationId&&m.status==='approved'&&db.logistics?.trips.some(t=>t.id===m.tripId&&!['closed','cancelled'].includes(t.status))).reduce((sum,m)=>sum+m.quantity,0);
 const loaned=loanQuantityAt(db,itemId,homeLocationId);
 return {have,planned,loaned,available:Math.max(0,have-planned-loaned)};
}
export function reviewPackingLines(db:Database,lines:PackingLine[]):ReviewedPackingLine[]{
 return lines.map(l=>({...l,destinationId:'',itemUpdatedAt:db.items.find(i=>i.id===l.itemId)?.updatedAt??'',balanceUpdatedAt:db.logistics?.balances.find(b=>b.itemId===l.itemId&&b.locationId===l.homeLocationId)?.updatedAt??''}));
}
