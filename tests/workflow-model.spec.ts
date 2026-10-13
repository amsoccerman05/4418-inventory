import {test,expect} from './browser-fixtures';
import {blankItem,type Database} from '../src/data';
import {enableLogistics,localAction} from '../src/services/logistics-local';
import {packingLocalAction} from '../src/services/packing-local';
import {availableForPacking,reviewPackingLines} from '../src/services/packing-model';
import {localToolAction} from '../src/services/tool-checkouts-local';
import {localPurchasingAction,localPurchasingContext,type PurchasingDatabase} from '../src/services/purchasing-local';
import {demoProfile} from '../src/services/types';

function fixture(){
 let db:Database=enableLogistics({version:1,areas:[{id:'area',name:'Mechanical',lead:''}],categories:['Tools'],locations:[
  {id:'home',name:'Toolbox A',bin:'TA',room:'Lab',storage:'',kind:'Storage'},
  {id:'project',name:'Project',bin:'',room:'Lab',storage:'',kind:'Storage'},
 ],items:[{...blankItem(),id:'drill',name:'School drill',itemType:'Tool',quantity:2,expectedQuantity:2,minimum:0,target:4,unit:'each',locationId:'home',areaId:'area',category:'Tools',ownership:'Shared / School'}]});
 db=localAction(db,'create_trip',{name:'Previous regional'});const source=db.logistics!.trips[0].id;
 db=localAction(db,'approve',{tripId:source,itemId:'drill',quantity:2,from:'home',to:db.locations.find(l=>l.tripId===source&&l.name==='Trailer')!.id});
 db=localAction(db,'resolve',{manifestId:db.logistics!.manifest[0].id,quantity:2,note:'Planned source only'});
 db=localAction(db,'trip_status',{tripId:source,status:'closed'});
 const saved=packingLocalAction(db,demoProfile,'save',{requestId:'save-kit',sourceTripId:source,name:'Drill kit'});db=saved.db;
 db=localAction(db,'create_trip',{name:'Next regional'});const target=db.logistics!.trips.at(-1)!.id;
 db=localToolAction(db,'checkout',{operationId:'loan',itemId:'drill',from:'home',to:'project',quantity:2,borrower:'Synthetic teammate',expectedReturn:'2026-12-31'});
 const review=(current:Database,quantity=2)=>({requestId:'approve-kit',templateId:saved.result.id,tripId:target,reviewed:true,lines:reviewPackingLines(current,[{itemId:'drill',quantity,homeLocationId:'project'}]).map(l=>({...l,destinationId:current.locations.find(d=>d.tripId===target&&d.name==='Trailer')!.id}))});
 return {db,target,review};
}

test('combined packing availability reserves active and missing loans and never releases them through review',()=>{
 const f=fixture();let db=f.db;
 expect(availableForPacking(db,'drill','project')).toEqual({have:2,planned:0,loaned:2,available:0});
 const before=structuredClone(db);expect(()=>packingLocalAction(db,demoProfile,'approve',f.review(db))).toThrow(/Not enough/);expect(db).toEqual(before);
 const loan=db.logistics!.toolLoans![0];db=localToolAction(db,'mark_missing',{operationId:'missing',loanId:loan.id,updatedAt:loan.updatedAt,note:'Looking for the drill'});
 expect(availableForPacking(db,'drill','project').available).toBe(0);
 expect(()=>packingLocalAction(db,demoProfile,'approve',f.review(db))).toThrow(/Not enough/);
 const missing=db.logistics!.toolLoans![0];db=localToolAction(db,'return',{operationId:'return-one',loanId:missing.id,updatedAt:missing.updatedAt,quantity:1});
 expect(availableForPacking(db,'drill','project')).toEqual({have:1,planned:0,loaned:1,available:0});
 expect(availableForPacking(db,'drill','home').available).toBe(1);
 expect(db.logistics!.packing!.templates).toEqual(f.db.logistics!.packing!.templates);
 expect(db.items[0].quantity).toBe(2);expect(db.items[0].ownership).toBe('Shared / School');
});

test('combined restock creates only unclaimed stock and template approval, borrower return and receipt retry stay independent',()=>{
 const f=fixture();let db:PurchasingDatabase=f.db;
 const initialLoan=structuredClone(db.logistics!.toolLoans![0]),stale=f.review(db);
 const purchase=(action:Parameters<typeof localPurchasingAction>[1],data:Parameters<typeof localPurchasingAction>[2])=>{db=localPurchasingAction(db,action,data);};
 purchase('configure',{item_id:'drill',version:0,supplier:'Synthetic Supplier',purchase_unit:'box',units_per_pack:2,pack_cost:20});
 purchase('request',{id:'restock',item_id:'drill',packs:1,settings_version:1});
 purchase('create_po',{request_id:'restock',version:1,amount:20,sheet_url:'https://docs.google.com/spreadsheets/d/synthetic'});
 purchase('demo_finance_approve',{request_id:'restock',version:2});purchase('demo_coach_approve',{request_id:'restock',version:3});
 purchase('demo_school_submit',{request_id:'restock',version:4});purchase('record_order',{request_id:'restock',version:5,reference:'SYNTHETIC'});
 const receipt={id:'delivery',request_id:'restock',version:6,quantity:2,location_id:'project',delivery_reference:'SYNTHETIC-DELIVERY'};
 purchase('receive',receipt);
 expect(db.logistics!.toolLoans![0]).toEqual(initialLoan);
 expect(availableForPacking(db,'drill','project')).toEqual({have:4,planned:0,loaned:2,available:2});
 expect(()=>packingLocalAction(db,demoProfile,'approve',stale)).toThrow(/Availability changed/);
 const command=f.review(db),approved=packingLocalAction(db,demoProfile,'approve',command);db=approved.db;
 expect(availableForPacking(db,'drill','project')).toEqual({have:4,planned:2,loaned:2,available:0});
 expect(packingLocalAction(db,demoProfile,'approve',command).db).toEqual(db);
 const before=structuredClone(db);expect(()=>packingLocalAction(db,demoProfile,'approve',{...f.review(db,1),requestId:'overcommit'})).toThrow(/Not enough/);expect(db).toEqual(before);
 const returnCommand={operationId:'return-original',loanId:initialLoan.id,updatedAt:initialLoan.updatedAt,quantity:2};
 db=localToolAction(db,'return',returnCommand);
 expect(availableForPacking(db,'drill','project')).toEqual({have:2,planned:2,loaned:0,available:0});
 db=localAction(db,'trip_status',{tripId:f.target,status:'packing'});
 db=localAction(db,'pack',{manifestId:approved.result.manifestIds![0],quantity:2});
 db=localAction(db,'return',{manifestId:approved.result.manifestIds![0],quantity:2});
 db=localAction(db,'trip_status',{tripId:f.target,status:'closed'});
 const finished=structuredClone(db);purchase('receive',receipt);expect(db).toEqual(finished);
 expect(localToolAction(db,'return',returnCommand)).toEqual(db);
 expect(db.items[0].quantity).toBe(4);expect(db.items[0].ownership).toBe('Shared / School');
 expect(localPurchasingContext(db).requests[0].state).toBe('received');
 expect(db.logistics!.toolLoans![0].returnedQuantity).toBe(2);
 expect(db.logistics!.manifest.find(m=>m.id===approved.result.manifestIds![0])!.ownership).toBe('Shared / School');
});
