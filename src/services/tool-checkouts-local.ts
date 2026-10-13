import {nextLocalTimestamp} from './local-version';
import type {Database} from '../data';
import {createId} from '../utils/id';
import {enableLogistics} from './logistics-local';
import {canCount,demoProfile,type UserProfile} from './types';
import {availableToolQuantity,loanQuantityAt,outstandingQuantity,toolActionSignature,type ToolAction,type ToolActionData,type ToolLoan} from './tool-checkouts-model';
/** Every demo update is prepared on a clone, then saved once by the repository. */
export function localToolAction(database:Database,action:ToolAction,d:ToolActionData,actor:UserProfile=demoProfile):Database {
 if(!canCount(actor))throw new Error('You do not have permission for tool checkout actions');
 if(!d.operationId)throw new Error('An operation ID is required');
 const db=structuredClone(enableLogistics(database)),g=db.logistics!;
 g.toolLoans??=[];g.toolOperations??=[];
 const signature=toolActionSignature(action,d),prior=g.toolOperations.find(o=>o.id===d.operationId);
 if(prior){if(prior.signature!==signature||prior.actor!==actor.id)throw new Error('This operation ID was already used for a different request');return db;}
 let loan=g.toolLoans.find(l=>l.id===d.loanId);
 const item=db.items.find(i=>i.id===(action==='checkout'?d.itemId:loan?.itemId));
 if(!item)throw new Error(action==='checkout'?'Item not found':'Loan not found');
 if(item.itemType!=='Tool')throw new Error('Only Tool items can be checked out. Consumables use quantity controls.');
 const now=nextLocalTimestamp(db);
 const note=(d.note??'').trim();
 const set=(locationId:string,quantity:number)=>{if(quantity<loanQuantityAt(db,item.id,locationId))throw new Error('Outstanding tool loans reserve this quantity. Return the specific loan first.');const b=g.balances.find(b=>b.itemId===item.id&&b.locationId===locationId);if(b){b.quantity=quantity;b.updatedAt=now;}else g.balances.push({id:createId(),itemId:item.id,locationId,quantity,updatedAt:now,lastVerified:''});};
 const transfer=(from:string,to:string,quantity:number,type:string)=>{const src=db.locations.find(l=>l.id===from),dst=db.locations.find(l=>l.id===to);if(!src||!dst||src.active===false||dst.active===false||src.tripId||dst.tripId||src.classification==='travel'||dst.classification==='travel'||from===to)throw new Error('Choose different active non-travel locations');const have=g.balances.find(b=>b.itemId===item.id&&b.locationId===from)?.quantity??0;if(quantity>have)throw new Error('Not enough quantity at the source');set(from,have-quantity);set(to,(g.balances.find(b=>b.itemId===item.id&&b.locationId===to)?.quantity??0)+quantity);g.movements.unshift({id:createId(),itemId:item.id,itemName:item.name,quantity,from,to,tripId:'',type,userId:actor.id,note,createdAt:now});};
 if(action==='checkout'){
  const quantity=Number(d.quantity),borrower=(d.borrower??'').trim(),project=(d.project??'').trim(),date=d.expectedReturn??'';
  if(!Number.isSafeInteger(quantity)||quantity<=0)throw new Error('Enter a positive whole number of tools');
  if(!borrower||borrower.length>160||project.length>200)throw new Error('Enter who has the tool (up to 160 characters)');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error('Choose a valid expected return date');
  if(quantity>availableToolQuantity(db,item.id,d.from??''))throw new Error('Not enough available tools at the source');
  transfer(d.from??'',d.to??'',quantity,'tool_checkout');
  loan={id:createId(),itemId:item.id,borrower,project,quantity,returnedQuantity:0,homeLocationId:d.from!,locationId:d.to!,expectedReturn:date,status:'out',notes:note,createdBy:actor.id,createdAt:now,updatedAt:now};g.toolLoans.push(loan);
 }else{
  if(!loan||!outstandingQuantity(loan))throw new Error('This loan is already returned');
  if(d.updatedAt!==loan.updatedAt)throw new Error('Loan changed. Review the latest outstanding quantity.');
  if(action==='return'){
   const quantity=Number(d.quantity);if(!Number.isSafeInteger(quantity)||quantity<=0||quantity>outstandingQuantity(loan))throw new Error('Return quantity exceeds the outstanding loan');
   loan.returnedQuantity+=quantity;if(!outstandingQuantity(loan))loan.status='returned';loan.updatedAt=now;
   transfer(loan.locationId,loan.homeLocationId,quantity,'tool_return');
  }else if(action==='mark_missing'||action==='mark_found'){
   if(!note)throw new Error('A note is required when changing missing status');
   if((action==='mark_missing'&&loan.status!=='out')||(action==='mark_found'&&loan.status!=='missing'))throw new Error('Loan status changed. Refresh first.');
   loan.status=action==='mark_missing'?'missing':'out';loan.updatedAt=now;
   g.movements.unshift({id:createId(),itemId:item.id,itemName:item.name,quantity:0,from:loan.locationId,to:loan.locationId,tripId:'',type:action==='mark_missing'?'tool_missing':'tool_found',userId:actor.id,note,createdAt:now});
  }else throw new Error('Unknown tool action');
  if(note)loan.notes=[loan.notes,note].filter(Boolean).join('\n');
 }
 item.quantity=g.balances.filter(b=>b.itemId===item.id).reduce((n,b)=>n+b.quantity,0);item.updatedAt=now;
 g.toolOperations.push({id:d.operationId,signature,actor:actor.id,loanId:loan.id});return db;
}
