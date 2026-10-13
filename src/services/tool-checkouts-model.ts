import type {Database} from '../data';
import type {Row} from './mapping';
export interface ToolLoan {
 id:string; itemId:string; borrower:string; project:string; homeLocationId:string; locationId:string;
 quantity:number; returnedQuantity:number; expectedReturn:string; status:'out'|'missing'|'returned';
 notes:string; createdBy:string; createdAt:string; updatedAt:string;
}
export type ToolAction='checkout'|'return'|'mark_missing'|'mark_found';
export interface ToolActionData {
 operationId:string; itemId?:string; loanId?:string; from?:string; to?:string; quantity?:number;
 borrower?:string; project?:string; expectedReturn?:string; note?:string; updatedAt?:string;
}
export interface ToolOperation {id:string; signature:string; actor:string; loanId:string}
export const outstandingQuantity=(loan:ToolLoan)=>Math.max(0,loan.quantity-loan.returnedQuantity);
export const outstandingLoans=(db:Database)=>(db.logistics?.toolLoans??[]).filter(l=>outstandingQuantity(l)>0);
export const loanQuantityAt=(db:Database,itemId:string,locationId:string)=>outstandingLoans(db).filter(l=>l.itemId===itemId&&l.locationId===locationId).reduce((n,l)=>n+outstandingQuantity(l),0);
export const approvedQuantityAt=(db:Database,itemId:string,locationId:string)=>(db.logistics?.manifest??[]).filter(m=>m.itemId===itemId&&m.homeLocationId===locationId&&m.status==='approved'&&db.logistics?.trips.some(t=>t.id===m.tripId&&!['closed','cancelled'].includes(t.status))).reduce((n,m)=>n+m.quantity,0);
export const availableToolQuantity=(db:Database,itemId:string,locationId:string)=>Math.max(0,(db.logistics?.balances.find(b=>b.itemId===itemId&&b.locationId===locationId)?.quantity??0)-loanQuantityAt(db,itemId,locationId)-approvedQuantityAt(db,itemId,locationId));
export const toolLoanFromRow=(r:Row):ToolLoan=>({id:String(r.id),itemId:String(r.inventory_item_id),borrower:String(r.borrower),project:String(r.project),homeLocationId:String(r.home_location_id),locationId:String(r.location_id),quantity:Number(r.quantity),returnedQuantity:Number(r.returned_quantity),expectedReturn:String(r.expected_return),status:r.status as ToolLoan['status'],notes:String(r.notes),createdBy:String(r.created_by),createdAt:String(r.created_at),updatedAt:String(r.updated_at)});
export const toolActionSignature=(action:ToolAction,data:ToolActionData)=>JSON.stringify([action,Object.fromEntries(Object.entries(data).sort(([a],[b])=>a.localeCompare(b)))]);
