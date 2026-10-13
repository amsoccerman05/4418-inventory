import type {Database} from '../data';
import {createId} from '../utils/id';
import {localAction} from './logistics-local';
import type {UserProfile} from './types';
import {availableForPacking,canManagePacking,plannedTripLines,type PackingCommand,type PackingReceipt,type PackingLine} from './packing-model';

export function packingLocalAction(database:Database,profile:UserProfile,action:'save'|'approve',command:PackingCommand):{db:Database;result:PackingReceipt}{
 if(!canManagePacking(profile))throw new Error('A lead, admin or mentor must manage packing templates');
 if(!database.logistics)throw new Error('Enable movement before using packing templates');
 let db=structuredClone(database);const state=db.logistics!.packing??={templates:[],requests:[]};
 const payload=JSON.stringify({action,command});
 if(!command.requestId)throw new Error('A request ID is required');
 const previous=state.requests.find(r=>r.id===command.requestId&&r.actor===profile.id);
 if(previous){if(previous.payload!==payload)throw new Error('Request ID was already used for different input');return {db,result:previous.result};}
 const sourceTrip=command.sourceTripId?db.logistics!.trips.find(t=>t.id===command.sourceTripId):undefined;
 let source:PackingLine[];
 if(action==='save'){
  if(!sourceTrip)throw new Error('Choose a source trip');
  if(sourceTrip.status==='cancelled')throw new Error('Cancelled trips cannot supply a packing template');
  source=plannedTripLines(db,sourceTrip.id);
 }else{
  if(!!command.templateId===!!command.sourceTripId)throw new Error('Choose one template or closed trip');
  if(command.sourceTripId&&sourceTrip?.status!=='closed')throw new Error('Only a closed previous trip can be copied');
  source=command.templateId?state.templates.find(t=>t.id===command.templateId)?.lines??[]:plannedTripLines(db,sourceTrip!.id);
 }
 if(!source.length||source.length>200)throw new Error('Choose a plan with 1–200 item allocations');
 let result:PackingReceipt;
 if(action==='save'){
  const name=command.name?.trim()??'';if(!name||name.length>100)throw new Error('Enter a template name up to 100 characters');
  const id=createId();state.templates.unshift({id,name,lines:source,sourceTripId:sourceTrip!.id,createdAt:new Date().toISOString(),createdBy:profile.id});result={id};
 }else{
  const trip=db.logistics!.trips.find(t=>t.id===command.tripId);
  if(!trip||!['planning','packing'].includes(trip.status))throw new Error('Approve items during planning or packing');
  if(!command.reviewed||!command.lines?.length||command.lines.length>200)throw new Error('Review quantities, locations and availability first');
  const totals=new Map<string,number>();
  for(const l of command.lines){
   const item=db.items.find(i=>i.id===l.itemId),home=db.locations.find(p=>p.id===l.homeLocationId),dest=db.locations.find(p=>p.id===l.destinationId);
   if(!source.some(s=>s.itemId===l.itemId)||!item)throw new Error('Item is no longer in the source plan');
   if(!Number.isFinite(l.quantity)||l.quantity<=0)throw new Error('Enter a finite quantity greater than zero');
   if(!home||home.active===false||home.tripId||!dest||dest.active===false||dest.tripId!==trip.id)throw new Error('Choose an active home and destination in this trip');
   const balance=db.logistics!.balances.find(b=>b.itemId===l.itemId&&b.locationId===l.homeLocationId);
   if(!l.itemUpdatedAt||item.updatedAt!==l.itemUpdatedAt||!balance||balance.updatedAt!==l.balanceUpdatedAt)throw new Error('Availability changed. Refresh and review again');
   const key=l.itemId+':'+l.homeLocationId;totals.set(key,(totals.get(key)??0)+l.quantity);
   if(totals.get(key)!>availableForPacking(db,l.itemId,l.homeLocationId).available)throw new Error('Not enough available stock after existing approvals');
  }
  const manifestIds:string[]=[];
  for(const l of command.lines){db=localAction(db,'approve',{tripId:trip.id,itemId:l.itemId,quantity:l.quantity,from:l.homeLocationId,to:l.destinationId,note:'Reviewed packing plan'});manifestIds.push(db.logistics!.manifest.at(-1)!.id);}
  result={manifestIds};
 }
 db.logistics!.packing!.requests.push({id:command.requestId,actor:profile.id,payload,result});return {db,result};
}
