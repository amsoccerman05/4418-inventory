import {nextLocalTimestamp} from './local-version';
import type {Database} from '../data';
import {createId} from '../utils/id';
import {positive,purchasingEmpty,validSheet,openRequest,restockBlocked,stockAdd,stockPacks,remaining,requireSupportedStock,type PurchasingAction,type PurchasingContext,type PurchasingData,type RestockRequest,type RestockReceipt} from './purchasing-model';
import {canCount,canEdit,type UserProfile,demoProfile} from './types';
interface DemoPO {id:string;number:number;status:string;revision:number;amount:number;requesterId:string;areaId:string;supplier:string;approvals:string[]}
interface DemoRequest extends RestockRequest {requester_id:string;po_id:string|null;po_revision:number|null;order_reference:string}
interface DemoReceipt extends RestockReceipt {actor_id:string;delivery_reference:string;note:string}
interface DemoPurchasing {settings:PurchasingContext['settings'];requests:DemoRequest[];receipts:DemoReceipt[];pos:DemoPO[];history:{action:string;actor:string;at:string;requestId?:string}[]}
export type PurchasingDatabase=Database&{purchasing?:DemoPurchasing};
const initial=():DemoPurchasing=>({settings:[],requests:[],receipts:[],pos:[],history:[]});
export function localPurchasingContext(db:PurchasingDatabase,profile:UserProfile=demoProfile,itemId?:string):PurchasingContext{
 if(!profile.active)throw new Error('Active team account required');
 const p=db.purchasing??initial();
 return {...purchasingEmpty(),can_request:canCount(profile),settings:p.settings.filter(s=>!itemId||s.item_id===itemId),
  requests:p.requests.filter(r=>!itemId||r.item_id===itemId).map(r=>{const item=db.items.find(i=>i.id===r.item_id)!;const po=p.pos.find(po=>po.id===r.po_id);const visible=po&&(po.requesterId===profile.id||['mentor','admin'].includes(profile.role)||(po.status!=='draft'&&profile.role==='lead'&&po.areaId===profile.primaryAreaId));
   const {requester_id:_,po_id:__,po_revision:___,order_reference:____,...safe}=r;
   return {...safe,can_manage:canCount(profile)&&(r.requester_id===profile.id||canEdit(profile,item.areaId)),can_record_order:!!visible&&['mentor','admin'].includes(profile.role),can_receive:canCount(profile)&&['ordered','partial'].includes(r.state),po:visible?{id:po.id,number:po.number,status:po.status,revision:po.revision,amount:po.amount,can_link:true}:null};}),
  receipts:p.receipts.filter(r=>!itemId||p.requests.find(x=>x.id===r.request_id)?.item_id===itemId).map(({id,request_id,quantity,location_id,created_at})=>({id,request_id,quantity,location_id,created_at}))};
}
export function localPurchasingAction(source:PurchasingDatabase,action:PurchasingAction,data:PurchasingData,profile:UserProfile=demoProfile):PurchasingDatabase{
 if(!canCount(profile))throw new Error('Inventory write access required');
 const db=structuredClone(source),p=db.purchasing??=initial(),now=nextLocalTimestamp(db),note=String(data.note??'').trim();
 if(note.length>2000)throw new Error('Notes must be at most 2000 characters');
 const audit=(requestId?:string)=>p.history.push({action,actor:profile.id,at:now,requestId});
 if(action==='configure'){
  const item=db.items.find(i=>i.id===data.item_id);if(!item||!canEdit(profile,item.areaId))throw new Error('Assigned lead, admin or mentor required');
  const old=p.settings.find(s=>s.item_id===item.id);if((old?.version??0)!==data.version)throw new Error('Purchasing setup changed. Refresh before saving.');
  const supplier=String(data.supplier??'').trim(),unit=String(data.purchase_unit??'').trim(),url=String(data.product_url??'').trim();
  if(!supplier||supplier.length>150||!unit||unit.length>50||!item.unit.trim()||item.unit.length>50)throw new Error('Supplier and purchase unit are required');
  if(url.length>2000||(url&&!/^https?:\/\/[^\s]+$/.test(url)))throw new Error('Use a valid http or https product URL');
  const setting={item_id:item.id,supplier,purchase_unit:unit,stock_unit:item.unit,product_url:url,units_per_pack:requireSupportedStock(positive(data.units_per_pack,'stock units per pack',1e6)),pack_cost:data.pack_cost===null||data.pack_cost===''?null:positive(data.pack_cost,'pack cost',999999999999.99),version:(old?.version??0)+1,updated_at:now};
  p.settings=p.settings.filter(s=>s.item_id!==item.id);p.settings.push(setting);audit();return db;
 }
 if(action==='request'){
  const item=db.items.find(i=>i.id===data.item_id);if(!item)throw new Error('Inventory item unavailable');
  const packs=positive(data.packs,'purchase packs',1e6);if(!Number.isInteger(packs)||!data.id)throw new Error('Choose whole purchase packs');
  const existing=p.requests.find(r=>r.id===data.id);if(existing){if(existing.requester_id!==profile.id||existing.item_id!==item.id||existing.packs!==packs||existing.note!==note)throw new Error('Request retry does not match the original');return db;}
  if(restockBlocked(item))throw new Error('This item is marked do not restock. An assigned lead must change its stock policy before creating a request');
  const s=p.settings.find(s=>s.item_id===item.id);if(!s||s.stock_unit!==item.unit)throw new Error('Set up and verify supplier and purchase-unit conversion first');
  if(s.version!==data.settings_version)throw new Error('Purchasing setup changed. Refresh before requesting.');
  if(p.requests.some(r=>r.item_id===item.id&&openRequest(r)))throw new Error('This item already has an open restock request');
  requireSupportedStock(stockPacks(packs,s.units_per_pack));requireSupportedStock(item.quantity);requireSupportedStock(stockAdd(item.quantity,stockPacks(packs,s.units_per_pack)));
  p.requests.unshift({id:String(data.id),item_id:item.id,requester_id:profile.id,area_id:item.areaId,item_name:item.name,supplier:s.supplier,product_url:s.product_url,purchase_unit:s.purchase_unit,stock_unit:s.stock_unit,packs,units_per_pack:s.units_per_pack,pack_cost:s.pack_cost,quantity:stockPacks(packs,s.units_per_pack),received:0,state:'requested',note,version:1,created_at:now,updated_at:now,closed_reason:'',po_id:null,po_revision:null,order_reference:'',po:null,can_manage:true,can_record_order:false,can_receive:false});audit(String(data.id));return db;
 }
 const r=p.requests.find(r=>r.id===data.request_id);if(!r)throw new Error('Restock request unavailable');
 const i=db.items.find(i=>i.id===r.item_id)!;
 if(action==='receive'){
  const c=p.receipts.find(c=>c.id===data.id);if(c){if(c.request_id!==r.id||c.quantity!==Number(data.quantity)||c.location_id!==data.location_id||c.actor_id!==profile.id||c.note!==note||c.delivery_reference!==String(data.delivery_reference??'').trim().toLowerCase())throw new Error('Receipt retry does not match the original');return db;}
 }
 if(r.version!==data.version)throw new Error('Restock request changed. Refresh before acting.');
 if(['create_po','link_po','cancel','close_short'].includes(action)&&r.requester_id!==profile.id&&!canEdit(profile,i.areaId))throw new Error('Requester or assigned inventory lead required');
 let po=p.pos.find(po=>po.id===r.po_id);
 if(action==='create_po'||action==='link_po'){
  if(r.state!=='requested'||r.po_id)throw new Error('A purchase order is already linked or this request is closed');
  if(i.areaId!==r.area_id||i.unit!==r.stock_unit)throw new Error('Item area or unit changed. Cancel this request and create a new one');
  if(action==='create_po'){
   if(i.orderStatus==='Ordered')throw new Error('Already marked Ordered in legacy inventory; link the existing PO or review the legacy order status before creating another draft');
   if(!validSheet(String(data.sheet_url??'')))throw new Error('Enter a Google Sheet or Google Doc URL');
   const amount=positive(data.amount,'PO total',999999999999.99);
   po={id:createId(),number:p.pos.length+1,status:'draft',revision:0,amount,requesterId:profile.id,areaId:r.area_id,supplier:r.supplier,approvals:[]};p.pos.push(po);
  }else po=p.pos.find(po=>po.id===data.po_id);
  if(!po||!(po.requesterId===profile.id||['mentor','admin'].includes(profile.role)))throw new Error('PO requester or Finance administrator required');
  if(po.status==='cancelled'||po.areaId!==r.area_id||po.supplier.toLowerCase()!==r.supplier.toLowerCase())throw new Error('Choose an active PO with the same supplier and team area');
  if(r.pack_cost!==null&&po.amount<r.packs*r.pack_cost)throw new Error('PO total is below the estimated restock amount');
  if(p.requests.some(x=>x.po_id===po!.id))throw new Error('This PO is already allocated to another inventory request');
  r.po_id=po.id;r.state='po_linked';
 }else if(action==='demo_finance_approve'||action==='demo_coach_approve'){
  if(!po||r.state!=='po_linked'||!['draft','awaiting_approval'].includes(po.status))throw new Error('Demo PO is not awaiting approval');
  const actor=action==='demo_finance_approve'?'demo-finance-lead':'demo-lead-coach';if(po.approvals.includes(actor))throw new Error('This demo approver has already approved');
  po.revision=1;po.approvals.push(actor);po.status=po.approvals.length===2?'approved':'awaiting_approval';
 }else if(action==='demo_school_submit'){
  if(!po||po.status!=='approved'||new Set(po.approvals).size!==2)throw new Error('Both demo approvals are required');po.status='submitted_to_school';
 }else if(action==='record_order'){
  if(r.state!=='po_linked'||!po||po.status!=='submitted_to_school'||new Set(po.approvals).size!==2)throw new Error('Both current-revision approvals and school submission are required');
  if(!['mentor','admin'].includes(profile.role))throw new Error('School submitter, admin or mentor with PO access required');
  const ref=String(data.reference??'').trim();if(!ref||ref.length>150)throw new Error('Enter the actual supplier order reference');
  r.state='ordered';r.po_revision=po.revision;r.order_reference=ref;
 }else if(action==='receive'){
  if(!['ordered','partial'].includes(r.state)||!po||po.status!=='submitted_to_school'||po.revision!==r.po_revision||new Set(po.approvals).size!==2)throw new Error('Only an explicitly recorded order with both approvals can be received');
  const qty=positive(data.quantity,'stock quantity');if(qty>remaining(r))throw new Error('Receive no more than the remaining stock units');
  requireSupportedStock(qty);requireSupportedStock(i.quantity);requireSupportedStock(stockAdd(i.quantity,qty));
  if(i.unit!==r.stock_unit)throw new Error('Inventory stock unit changed. Restore the original unit before receiving');
  const dst=db.locations.find(l=>l.id===data.location_id&&l.active!==false&&!l.tripId);if(!dst)throw new Error('Choose an active non-travel receiving location');
  const ref=String(data.delivery_reference??'').trim().toLowerCase();if(!data.id||!ref||ref.length>150)throw new Error('Delivery reference is required');
  if(p.receipts.some(c=>c.request_id===r.id&&c.delivery_reference===ref))throw new Error('This delivery reference has already been received');
  if(db.logistics){let balance=db.logistics.balances.find(b=>b.itemId===i.id&&b.locationId===dst.id);if(!balance){balance={id:createId(),itemId:i.id,locationId:dst.id,quantity:0,updatedAt:now,lastVerified:''};db.logistics.balances.push(balance);}requireSupportedStock(balance.quantity);balance.quantity=requireSupportedStock(stockAdd(balance.quantity,qty));balance.updatedAt=now;i.quantity=db.logistics.balances.filter(b=>b.itemId===i.id).reduce((n,b)=>stockAdd(n,b.quantity),0);db.logistics.movements.unshift({id:createId(),itemId:i.id,itemName:i.name,quantity:qty,from:'',to:dst.id,tripId:'',type:'adjustment',userId:profile.id,note:`Restock receipt ${data.id} for request ${r.id}`,createdAt:now});}
  else {if(dst.id!==i.locationId)throw new Error('Enable location balances before receiving away from the home location');i.quantity=stockAdd(i.quantity,qty);}
  i.updatedAt=now;i.updatedBy=profile.id;r.received=stockAdd(r.received,qty);r.state=r.received===r.quantity?'received':'partial';
  p.receipts.push({id:String(data.id),request_id:r.id,quantity:qty,location_id:dst.id,created_at:now,actor_id:profile.id,delivery_reference:ref,note});
 }else if(action==='cancel'){
  if(!['requested','po_linked'].includes(r.state)||!note)throw new Error('Cancellation reason is required; ordered requests must be closed short');
  if(po&&po.status!=='cancelled')throw new Error('Cancel the linked PO in Finance before cancelling this request');r.state='cancelled';r.closed_reason=note;
 }else if(action==='close_short'){
  if(!canEdit(profile,i.areaId)||!['ordered','partial'].includes(r.state)||!note)throw new Error('Assigned lead must explain why the remaining order will not arrive');r.state='closed_short';r.closed_reason=note;
 }else throw new Error('Unknown purchasing action');
 r.version++;r.updated_at=now;audit(r.id);return db;
}
