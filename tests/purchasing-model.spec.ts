import {test,expect} from './browser-fixtures';
import {demo,blankItem,type Database} from '../src/data';
import {localAction} from '../src/services/logistics-local';
import {localPurchasingAction,localPurchasingContext,type PurchasingDatabase} from '../src/services/purchasing-local';
import {purchasingSummary,type PurchasingAction,type PurchasingData} from '../src/services/purchasing-model';
const item={...blankItem(),id:'demo-test',name:'Wire',areaId:'power',locationId:'e-04',unit:'ft',quantity:3,minimum:5,target:30};
const base=():PurchasingDatabase=>localAction({...demo(),items:[item]},'enable',{});
function flow(){let db=base();const run=(a:PurchasingAction,p:PurchasingData)=>{db=localPurchasingAction(db,a,p);return db;};const current=()=>localPurchasingContext(db).requests[0];
 run('configure',{item_id:item.id,version:0,supplier:'Supplier',product_url:'',purchase_unit:'reel',units_per_pack:12.5,pack_cost:10});
 run('request',{id:'request-1',item_id:item.id,packs:2,settings_version:1,note:''});
 return {run,current,get db(){return db;}};
}
test('purchasing recommendations subtract both requested and actually ordered stock',()=>{
 const f=flow();let s=purchasingSummary(item,localPurchasingContext(f.db));expect(s.requested).toBe(25);expect(s.onOrder).toBe(0);expect(s.shortage).toBe(2);expect(s.suggestedPacks).toBe(1);
 const unconfigured={...item,target:0};s=purchasingSummary(unconfigured,localPurchasingContext(f.db));expect(s.shortage).toBeNull();expect(s.suggestedPacks).toBeNull();expect(s.setup).toContain('target stock');
});
test('demo full path uses two distinct approvals, stock units, atomic save and exact retry',()=>{
 const f=flow();f.run('create_po',{request_id:'request-1',version:1,amount:25,sheet_url:'https://docs.google.com/spreadsheets/d/demo'});
 expect(f.current().po?.status).toBe('draft');expect(()=>f.run('record_order',{request_id:'request-1',version:2,reference:'ORDER'})).toThrow(/Both/);
 f.run('demo_finance_approve',{request_id:'request-1',version:2});expect(()=>f.run('demo_finance_approve',{request_id:'request-1',version:3})).toThrow(/already/);
 f.run('demo_coach_approve',{request_id:'request-1',version:3});f.run('demo_school_submit',{request_id:'request-1',version:4});f.run('record_order',{request_id:'request-1',version:5,reference:'ORDER'});
 const receipt={id:'receipt-1',request_id:'request-1',version:6,quantity:7.5,location_id:item.locationId,delivery_reference:'SLIP-A',note:''};
 f.run('receive',receipt);f.run('receive',receipt);expect(f.db.items[0].quantity).toBe(10.5);expect(f.current().state).toBe('partial');
 expect(()=>f.run('receive',{...receipt,id:'other',version:7})).toThrow(/already been received/);
 expect(()=>f.run('receive',{...receipt,id:'other',version:7,delivery_reference:'B',quantity:18})).toThrow(/remaining/);
 expect(f.db.items[0].quantity).toBe(10.5);expect(purchasingSummary(f.db.items[0],localPurchasingContext(f.db)).onOrder).toBe(17.5);
 f.run('receive',{...receipt,id:'receipt-2',version:7,quantity:17.5,delivery_reference:'SLIP-B'});expect(f.current().state).toBe('received');expect(f.db.items[0].quantity).toBe(28);
});
test('demo enforces immutable request snapshots, matching retries, and role restrictions',()=>{
 const f=flow();expect(()=>f.run('request',{id:'another',item_id:item.id,packs:1,settings_version:1})).toThrow(/already has/);
 f.run('configure',{item_id:item.id,version:1,supplier:'Supplier',product_url:'',purchase_unit:'box',units_per_pack:100,pack_cost:20});expect(f.current().quantity).toBe(25);
 expect(()=>f.run('request',{id:'request-1',item_id:item.id,packs:9,settings_version:2})).toThrow(/does not match/);
 expect(()=>localPurchasingAction(f.db,'receive',{}, {id:'readonly',role:'readonly',active:true,primaryAreaId:null,email:'',displayName:''})).toThrow(/write access/);
});
test('explicit do-not-restock suppresses recommendations and new requests but keeps open history',()=>{
 const f=flow();const blocked={...f.db.items[0],restockPolicy:'do_not_restock'};const db={...f.db,items:[blocked]};
 expect(purchasingSummary(blocked,localPurchasingContext(db)).suggestedPacks).toBeNull();
 expect(localPurchasingContext(db).requests).toHaveLength(1);
 const empty={...db,purchasing:{...db.purchasing!,requests:[]}};
 expect(()=>localPurchasingAction(empty,'request',{id:'blocked',item_id:item.id,packs:1,settings_version:1})).toThrow(/marked do not restock/);
});
test('decimal partial receipts close exactly without floating-point overreceipt errors',()=>{
 let db=base();const run=(a:PurchasingAction,p:PurchasingData)=>{db=localPurchasingAction(db,a,p);};
 run('configure',{item_id:item.id,version:0,supplier:'Supplier',purchase_unit:'spool',units_per_pack:0.1,pack_cost:null});run('request',{id:'decimal',item_id:item.id,packs:3,settings_version:1});
 run('create_po',{request_id:'decimal',version:1,amount:1,sheet_url:'https://docs.google.com/spreadsheets/d/demo'});run('demo_finance_approve',{request_id:'decimal',version:2});run('demo_coach_approve',{request_id:'decimal',version:3});run('demo_school_submit',{request_id:'decimal',version:4});run('record_order',{request_id:'decimal',version:5,reference:'ORDER'});
 run('receive',{id:'d1',request_id:'decimal',version:6,quantity:0.1,location_id:item.locationId,delivery_reference:'A'});run('receive',{id:'d2',request_id:'decimal',version:7,quantity:0.2,location_id:item.locationId,delivery_reference:'B'});
 expect(localPurchasingContext(db).requests[0].state).toBe('received');expect(db.items[0].quantity).toBe(3.3);
});
test('legacy Ordered flag has unknown quantity and cannot silently create another draft',()=>{
 const f=flow(),legacy={...f.db.items[0],orderStatus:'Ordered' as const},db={...f.db,items:[legacy]};
 const summary=purchasingSummary(legacy,localPurchasingContext(db));expect(summary.legacyOrder).toBe(true);expect(summary.suggestedPacks).toBeNull();
 expect(()=>localPurchasingAction(db,'create_po',{request_id:'request-1',version:1,amount:25,sheet_url:'https://docs.google.com/spreadsheets/d/demo'})).toThrow(/Already marked Ordered/);
 expect(db.purchasing?.pos).toHaveLength(0);expect(db.items[0].orderStatus).toBe('Ordered');
});
test('demo rejects quantities whose JSON numeric representation could hide a remainder',()=>{
 let db=base();db=localPurchasingAction(db,'configure',{item_id:item.id,version:0,supplier:'Supplier',purchase_unit:'reel',units_per_pack:999999.999999,pack_cost:null});
 expect(()=>localPurchasingAction(db,'request',{id:'extreme',item_id:item.id,packs:999999,settings_version:1})).toThrow(/supports totals/);
 expect(()=>localPurchasingAction(base(),'configure',{item_id:item.id,version:0,supplier:'Supplier',purchase_unit:'reel',units_per_pack:0.0000001,pack_cost:null})).toThrow(/6 decimal/);
});
