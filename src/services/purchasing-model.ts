import type {Item} from '../data';
export type PurchasingAction='configure'|'request'|'create_po'|'link_po'|'record_order'|'receive'|'cancel'|'close_short'|'demo_finance_approve'|'demo_coach_approve'|'demo_school_submit';
export type PurchasingData=Record<string,string|number|null>;
export interface PurchasingSetting {
 item_id:string;supplier:string;product_url:string;purchase_unit:string;stock_unit:string;
 units_per_pack:number;pack_cost:number|null;version:number;updated_at:string;
}
export interface LinkedPurchaseOrder {id:string;number:number;status:string;revision:number;amount:number;can_link:boolean}
export interface RestockRequest {
 id:string;item_id:string;area_id:string;item_name:string;supplier:string;product_url:string;purchase_unit:string;stock_unit:string;
 packs:number;units_per_pack:number;pack_cost:number|null;quantity:number;received:number;
 state:'requested'|'po_linked'|'ordered'|'partial'|'received'|'cancelled'|'closed_short';note:string;
 version:number;created_at:string;updated_at:string;closed_reason:string;
 can_manage:boolean;can_record_order:boolean;can_receive:boolean;po:LinkedPurchaseOrder|null;
}
export interface RestockReceipt {id:string;request_id:string;quantity:number;location_id:string;created_at:string}
export interface PurchasingContext {available:boolean;can_request:boolean;settings:PurchasingSetting[];requests:RestockRequest[];receipts:RestockReceipt[]}
export interface PurchasingRepository {
 readonly mode:'demo'|'supabase';load(itemId?:string):Promise<PurchasingContext>;
 action(action:PurchasingAction,data:PurchasingData):Promise<void>;
}
// Decimal stock arithmetic avoids JS 0.1 + 0.2 overreceipt/never-closed artifacts
// in the demo and projections; PostgreSQL remains the production authority.
const decimalParts=(n:number):[bigint,number]=>{const [mantissa,exponent='0']=String(n).split('e');const [whole,fraction='']=mantissa.split('.');const scale=fraction.length-Number(exponent);return scale<0?[BigInt(whole+fraction)*10n**BigInt(-scale),0]:[BigInt(whole+fraction),scale];};
const fromDecimal=(value:bigint,scale:number)=>{const negative=value<0n;const digits=(negative?-value:value).toString().padStart(scale+1,'0');return Number((negative?'-':'')+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits));};
export const supportedStock=(n:number)=>Number.isFinite(n)&&n>=0&&n<=100000000&&decimalParts(n)[1]<=6;
export const requireSupportedStock=(n:number)=>{if(!supportedStock(n))throw new Error('Purchasing supports totals up to 100000000 stock units and 6 decimal places');return n;};
export const stockAdd=(a:number,b:number)=>{const [x,s]=decimalParts(a),[y,t]=decimalParts(b),scale=Math.max(s,t);return fromDecimal(x*10n**BigInt(scale-s)+y*10n**BigInt(scale-t),scale);};
export const stockPacks=(packs:number,units:number)=>{const [value,scale]=decimalParts(units);return fromDecimal(value*BigInt(packs),scale);};
export const restockBlocked=(item:Item)=>(item as Item&{restockPolicy?:string}).restockPolicy==='do_not_restock';
export const openRequest=(r:RestockRequest)=>['requested','po_linked','ordered','partial'].includes(r.state);
export const remaining=(r:RestockRequest)=>Math.max(0,stockAdd(r.quantity,-r.received));
export function purchasingSummary(item:Item,context:PurchasingContext){
 const settings=context.settings.find(s=>s.item_id===item.id);
 const requests=context.requests.filter(r=>r.item_id===item.id);
 const requested=requests.filter(r=>['requested','po_linked'].includes(r.state)).reduce((n,r)=>stockAdd(n,remaining(r)),0);
 const onOrder=requests.filter(r=>['ordered','partial'].includes(r.state)).reduce((n,r)=>stockAdd(n,remaining(r)),0);
 const legacyOrder=item.orderStatus==='Ordered'&&onOrder===0;
 const shortage=!legacyOrder&&!restockBlocked(item)&&item.target>0?Math.max(0,stockAdd(stockAdd(stockAdd(item.target,-(item.totalQuantity??item.quantity)),-requested),-onOrder)):null;
 const setup:string[]=[];
 if(!restockBlocked(item)&&item.target<=0)setup.push('target stock');
 if(!settings)setup.push('supplier and purchase unit');
 else {if(settings.stock_unit!==item.unit)setup.push('stock-unit conversion');if(!settings.pack_cost)setup.push('estimated pack cost');}
 return {settings,requests,requested,onOrder,shortage,setup,legacyOrder,
  suggestedPacks:shortage!==null&&settings&&settings.stock_unit===item.unit?Math.ceil(shortage/settings.units_per_pack):null,
  open:requests.find(openRequest)};
}
export const purchasingEmpty=():PurchasingContext=>({available:true,can_request:true,settings:[],requests:[],receipts:[]});
export const validSheet=(s:string)=>/^https:\/\/docs\.google\.com\/(spreadsheets|document)\/d\/[A-Za-z0-9_-]+([/?#][^\s]*)?$/.test(s);
export function positive(value:unknown,label:string,max=1e12){const n=Number(value);if(!Number.isFinite(n)||n<=0||n>max)throw new Error(`Enter a positive ${label} no greater than ${max}.`);return n;}
