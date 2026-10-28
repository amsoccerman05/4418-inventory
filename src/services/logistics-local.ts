import {createId} from '../utils/id';
import type {Database} from '../data';
import {type Logistics,type InventoryAction,type ActionData,type Manifest,type TripStatus} from './logistics-model';
export function enableLogistics(db:Database):Database {
 if(db.logistics)return db;
 const now=new Date().toISOString();const unassigned='local-unassigned';
 return {...db,locations:[...db.locations,...(db.items.some(i=>!i.locationId)?[{id:unassigned,name:'Unassigned',bin:'UNASSIGNED',kind:'Storage' as const,room:'',storage:''}]:[])],items:db.items.map(i=>({...i,locationId:i.locationId||unassigned})),logistics:{balances:db.items.map(i=>({id:createId(),itemId:i.id,locationId:i.locationId||unassigned,quantity:i.quantity,updatedAt:now,lastVerified:i.lastVerified,lastVerifiedBy:i.lastVerifiedBy})),trips:[],manifest:[],movements:[],media:[]}};
}
export function localAction(database:Database,action:InventoryAction|'enable',d:ActionData):Database {
 const db=structuredClone(enableLogistics(database)),g=db.logistics!;const now=new Date().toISOString();
 const str=(k:string)=>String(d[k]??'');const qty=Number(d.quantity);const note=str('note');
 if(action==='enable')return db;
 if(action==='create_trip'){
  if(!str('name').trim())throw new Error('Enter a trip name');const id=createId();g.trips.push({id,name:str('name'),event:str('event'),destination:str('destination'),start:str('start'),end:str('end'),status:'planning',notes:note});
  const parent=createId();db.locations.push({id:parent,name:str('name'),bin:str('name'),storage:'',room:'',kind:'Storage',classification:'travel',tripId:id});
  for(const name of ['Trailer','Pit Toolbox A','Pit Toolbox B','Robot Cart','Programming Case','Battery Cart'])db.locations.push({id:createId(),name,bin:name,storage:'',room:'',kind:'Storage',classification:'travel',tripId:id,parentId:parent});return db;
 }
 const m=g.manifest.find(x=>x.id===str('manifestId'));const tid=m?.tripId||str('tripId');const trip=g.trips.find(t=>t.id===tid);
 if(trip&&['closed','cancelled'].includes(trip.status))throw new Error('Trip is archived');
 if(action==='trip_status'){
  if(!trip)throw new Error('Trip not found');const state=str('status') as TripStatus;
  if(['closed','cancelled'].includes(state)){
   if(g.manifest.some(x=>x.tripId===tid&&['approved','packed'].includes(x.status)))throw new Error('Unresolved manifest items remain. Return or explicitly resolve each item first.');
   if(g.balances.some(b=>b.quantity>0&&db.locations.some(l=>l.id===b.locationId&&l.tripId===tid)))throw new Error('Travel locations still contain stock');
   db.locations=db.locations.map(l=>l.tripId===tid?{...l,active:false}:l);
  }
  trip.status=state;g.movements.unshift({id:createId(),itemId:'',itemName:trip.name,quantity:0,from:'',to:'',tripId:tid,type:'resolution',userId:'local-demo',note:'Trip status: '+state,createdAt:now});return db;
 }
 if(action==='configure_location'){const l=db.locations.find(l=>l.id===str('id'));if(!l)throw new Error('Location unavailable');if((l.updatedAt||'')!==str('updatedAt'))throw new Error('This location changed. Close and reopen settings before trying again.');if(['Drawer','Bin'].includes(str('kind'))&&db.locations.some(c=>c.parentId===l.id))throw new Error('A location with children cannot become a drawer or bin');l.kind=str('kind') as typeof l.kind;l.classification=str('classification') as typeof l.classification;l.updatedAt=new Date().toISOString();return db;}
 if(action==='rename_location'){const l=db.locations.find(l=>l.id===str('id'));if(!l)throw new Error('Location unavailable');if((l.updatedAt||'')!==str('updatedAt'))throw new Error('This location changed. Close and reopen Rename before trying again.');const name=str('name').trim();if(!name||name.length>200)throw new Error('Enter a location name up to 200 characters');l.name=name;l.updatedAt=new Date().toISOString();return db;}
 if(action==='create_location'){db.locations.push({id:createId(),name:str('name'),bin:str('name'),storage:str('name'),room:db.locations.find(l=>l.id===str('parentId'))?.room||str('room'),parentId:str('parentId')||null,kind:(str('kind')||'Storage') as typeof db.locations[number]['kind'],classification:str('classification') as 'project',areaId:str('areaId'),description:note,updatedAt:new Date().toISOString()});return db;}
 const item=db.items.find(i=>i.id===(m?.itemId||str('itemId')));if(!item)throw new Error('Item not found');
 let src=m?(m.status==='approved'?m.homeLocationId:m.currentLocationId):str('from');let dst=action==='pack'?m?.currentLocationId:action==='return'?m?.homeLocationId:str('to');
 const source=db.locations.find(l=>l.id===src),dest=db.locations.find(l=>l.id===dst);
 const balance=g.balances.find(b=>b.itemId===item.id&&b.locationId===src);const have=balance?.quantity??0;
 const event=(type:string,q:number,from=src,to=dst||'',text=note)=>g.movements.unshift({id:createId(),itemId:item.id,itemName:item.name,quantity:q,from,to,tripId:tid,type,userId:'local-demo',note:text,createdAt:now});
 const set=(id:string,q:number)=>{const b=g.balances.find(x=>x.itemId===item.id&&x.locationId===id);if(b){b.quantity=q;b.updatedAt=now;}else g.balances.push({id:createId(),itemId:item.id,locationId:id,quantity:q,updatedAt:now,lastVerified:''});};
 if(action==='resolve'&&m?.status==='approved'){if(!note.trim())throw new Error('A resolution note is required');if(!Number.isFinite(qty)||qty<=0||qty>m.quantity)throw new Error('Quantity exceeds this approval');if(qty<m.quantity){m.quantity-=qty;g.manifest.push({...m,id:createId(),quantity:qty,status:'resolved',resolution:'Not packed: '+note});}else{m.status='resolved';m.resolution='Not packed: '+note;}event('resolution',0);return db;}
 if(!Number.isFinite(qty)||qty<(action==='adjust'?0:Number.MIN_VALUE))throw new Error('Enter a valid quantity');
 if(!source||source.active===false)throw new Error('Source is unavailable');
 if(action==='adjust'){
  if(source.tripId)throw new Error('Resolve travel differences from the return audit');
  if(item.updatedAt!==str('updatedAt'))throw new Error('Item changed. Review the latest count');
  set(src,qty);event('adjustment',Math.abs(qty-have),qty<have?src:'',qty>have?src:'');
  if(d.verify){const b=g.balances.find(x=>x.itemId===item.id&&x.locationId===src)!;b.lastVerified=now;b.lastVerifiedBy='local-demo';if(item.locationId===src)item.lastVerified=now;}
 }else{
  if(['pack','internal','return'].includes(action)&&trip?.status==='planning')throw new Error('Start packing first');
  if(action==='resolve'&&['lost','consumed'].includes(str('resolution')))dst='';
  if(action==='resolve'&&!note.trim())throw new Error('A resolution note is required');
  if(dst===src||(!dst&&action!=='resolve'))throw new Error('Choose different source and destination locations');
  if(dst&&(!dest||dest.active===false))throw new Error('Destination is unavailable');
  if(action==='move'&&(source.tripId||dest?.tripId))throw new Error('Use the trip manifest for travel inventory');
  if(action==='approve'){
   if(!trip||!['planning','packing'].includes(trip.status)||source.tripId||dest?.tripId!==tid)throw new Error('Choose a home and a destination in this trip');
   g.manifest.push({id:createId(),tripId:tid,itemId:item.id,quantity:qty,ownership:item.ownership,homeLocationId:src,currentLocationId:dst!,status:'approved',resolution:'',notes:note});event('resolution',0,src,dst,'Approved for packing');return db;
  }
  if(qty>have)throw new Error('Not enough quantity at the source');
  if(m){
   if(qty>m.quantity||(action==='pack'?m.status!=='approved':m.status!=='packed'))throw new Error('Allocation changed');
   if(['pack','internal'].includes(action)&&dest?.tripId!==tid)throw new Error('Choose a destination in this trip');
   if(action==='resolve'&&dest?.tripId)throw new Error('Resolve to a non-travel location');
   const updated:Manifest={...m,quantity:qty,currentLocationId:dst||src,status:action==='return'?'returned':action==='resolve'?'resolved':'packed',resolution:action==='resolve'?str('resolution')+': '+note:''};
   if(qty<m.quantity){m.quantity-=qty;g.manifest.push({...updated,id:createId()});}else Object.assign(m,updated);
  }
  set(src,have-qty);if(dst)set(dst,(g.balances.find(b=>b.itemId===item.id&&b.locationId===dst)?.quantity??0)+qty);
  event(({move:'transfer',pack:'trip_pack',internal:'trip_internal_move',return:'trip_return',resolve:'resolution'} as Record<string,string>)[action],qty);
 }
 item.quantity=g.balances.filter(b=>b.itemId===item.id).reduce((n,b)=>n+b.quantity,0);item.updatedAt=now;return db;
}
export function syncLocalBalances(before:Database,next:Database):Database {
 if(!before.logistics)return next;if(before.logistics.manifest.some(m=>!next.items.some(i=>i.id===m.itemId)))throw new Error('Trip history references this item; it cannot be deleted.');const result=structuredClone(next),g=result.logistics=structuredClone(before.logistics);
 for(const item of result.items){const old=before.items.find(i=>i.id===item.id);const home=item.locationId;
  if(!home)throw new Error('Choose a home location for tracked balances');
  const others=g.balances.filter(b=>b.itemId===item.id&&b.locationId!==(old?.locationId||home));
  if(old&&old.locationId!==home&&others.some(b=>b.quantity>0))throw new Error('Return allocated stock before changing home');
  if(old&&old.locationId!==home)g.balances=g.balances.filter(b=>b.itemId!==item.id);
  let b=g.balances.find(b=>b.itemId===item.id&&b.locationId===home);
  const otherTotal=g.balances.filter(b=>b.itemId===item.id&&b.locationId!==home).reduce((n,b)=>n+b.quantity,0);
  if(item.quantity<otherTotal)throw new Error('Correct the specific location instead of reducing allocated stock');
  if(!b){b={id:createId(),itemId:item.id,locationId:home,quantity:0,updatedAt:item.updatedAt,lastVerified:item.lastVerified};g.balances.push(b);}b.quantity=item.quantity-otherTotal;b.lastVerified=item.lastVerified;b.updatedAt=item.updatedAt;
 }
 g.balances=g.balances.filter(b=>result.items.some(i=>i.id===b.itemId));return result;
}
