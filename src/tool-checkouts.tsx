import {useRef,useState} from 'react';
import {ArrowDownLeft,ArrowUpRight,ClipboardCheck,Search,Wrench} from 'lucide-react';
import {locationPath,type Database} from './data';
import {CreationModal} from './logistics';
import {inventoryRepository as repository} from './services/repository';
import {canCount,type UserProfile} from './services/types';
import {friendlyError} from './services/supabase';
import {createId} from './utils/id';
import {availableToolQuantity,outstandingQuantity,type ToolAction,type ToolActionData,type ToolLoan} from './services/tool-checkouts-model';
import './tool-checkouts.css';

const localDate=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
export function ToolCheckouts({db,profile,refresh,itemId}:{db:Database;profile:UserProfile;refresh:()=>Promise<void>;itemId?:string}){
 const [search,setSearch]=useState(''),[filter,setFilter]=useState('outstanding'),[checkout,setCheckout]=useState(false);
 const [operation,setOperation]=useState<{loan:ToolLoan;action:Exclude<ToolAction,'checkout'>}|null>(null);
 const loans=(db.logistics?.toolLoans??[]).filter(l=>!itemId||l.itemId===itemId),outstanding=loans.filter(l=>outstandingQuantity(l)>0),today=localDate(),countable=canCount(profile);
 if(repository.mode==='supabase'&&db.logistics?.toolLoans===undefined)return <section className="panel settings-panel"><h2>Tool checkouts</h2><p>Tool checkouts are not enabled in this workspace yet. Ask a mentor to complete the checkout upgrade.</p></section>;
 const visible=loans.filter(l=>(filter==='all'||(filter==='returned'?l.status==='returned':filter==='missing'?l.status==='missing':filter==='overdue'?outstandingQuantity(l)>0&&l.expectedReturn<today:outstandingQuantity(l)>0))&&[db.items.find(i=>i.id===l.itemId)?.name,l.borrower,l.project,locationPath(db.locations,l.locationId)].join(' ').toLowerCase().includes(search.toLowerCase()));
 return <section className="tool-checkouts" aria-label="Tool checkouts">
  <div className="panel-heading"><div><h2>Tool checkouts</h2><p>Know who has each tool and where it should come back.</p></div>{countable&&<button type="button" className="primary" onClick={()=>setCheckout(true)}><ArrowUpRight size={17}/>Check out tool</button>}</div>
  <div className="checkout-summary"><span><b>{outstanding.reduce((n,l)=>n+outstandingQuantity(l),0)}</b> tools checked out</span><span><b>{outstanding.filter(l=>l.expectedReturn<today).length}</b> overdue loans</span><span><b>{outstanding.filter(l=>l.status==='missing').length}</b> marked missing</span></div>
  <p className="checkout-note">Checked-out tools remain in the owned total. Return a specific loan to make its tools available again. Consumables stay in quantity tracking.</p>
  <div className="panel"><div className="filters"><label className="search"><Search size={18}/><input aria-label="Search tool checkouts" placeholder="Tool, borrower, project, or location…" value={search} onChange={e=>setSearch(e.target.value)}/></label><label className="checkout-filter">Show<select aria-label="Filter tool loans" value={filter} onChange={e=>setFilter(e.target.value)}><option value="outstanding">Outstanding</option><option value="overdue">Overdue</option><option value="missing">Missing</option><option value="returned">Returned</option><option value="all">All loans</option></select></label></div>
   {!visible.length?<div className="empty"><ClipboardCheck size={32}/><h3>{loans.length?'No loans match these filters':'No tool loans yet'}</h3><p>{loans.length?'Try a different search or filter.':'Check out a tool to record who has it, its location, and an expected return.'}</p></div>:
    <div className="checkout-list">{visible.slice().sort((a,b)=>a.expectedReturn.localeCompare(b.expectedReturn)||b.createdAt.localeCompare(a.createdAt)).map(l=>{
     const item=db.items.find(i=>i.id===l.itemId),remaining=outstandingQuantity(l),overdue=remaining>0&&l.expectedReturn<today;
     return <article className="checkout-card" key={l.id} aria-label={(item?.name??'Tool')+' loan to '+l.borrower}>
      <div className="checkout-card-heading"><Wrench size={19}/><h3>{item?.name??'Tool'}</h3><span className={'badge '+(l.status==='returned'?'good':l.status==='missing'||overdue?'low':'')}>{l.status==='returned'?'Returned':l.status==='missing'?'Missing':overdue?'Overdue':'Checked out'}</span></div>
      <div className="checkout-details"><p><small>With</small><b>{l.borrower}</b></p><p><small>Project / purpose</small>{l.project||'—'}</p><p><small>At location</small>{locationPath(db.locations,l.locationId)}</p><p><small>Return to</small>{locationPath(db.locations,l.homeLocationId)}</p><p><small>Expected return</small>{l.expectedReturn}</p><p><small>Outstanding / original</small><b>{remaining} / {l.quantity}</b></p></div>
      {l.notes&&<p className="checkout-loan-notes">{l.notes}</p>}
      {remaining>0&&countable&&<div className="button-row"><button type="button" className="secondary" onClick={()=>setOperation({loan:l,action:'return'})}><ArrowDownLeft size={15}/>Return tools</button><button type="button" className="text-button" onClick={()=>setOperation({loan:l,action:l.status==='missing'?'mark_found':'mark_missing'})}>{l.status==='missing'?'Mark found':'Mark missing'}</button></div>}
     </article>;
    })}</div>}
  </div>
  {checkout&&<CheckoutDialog db={db} itemId={itemId} refresh={refresh} close={()=>setCheckout(false)}/>}
  {operation&&<LoanDialog db={db} loan={operation.loan} action={operation.action} refresh={refresh} close={()=>setOperation(null)}/>}
 </section>;
}

function useToolSubmit(refresh:()=>Promise<void>,close:()=>void){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[stale,setStale]=useState(false);
 const pending=useRef<{action:ToolAction;data:ToolActionData}|null>(null),lock=useRef(false);
 return {busy,error,uncertain,stale,reviewLatest:()=>{setStale(false);setError('');},submit:async(action:ToolAction,data:Omit<ToolActionData,'operationId'>)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  const request=pending.current??{action,data:{...data,operationId:createId()}};pending.current=request;
  let saved=false;
  try{await repository.toolAction(request.action,request.data);saved=true;await refresh();close();}
  catch(e){
   const code=e&&typeof e==='object'&&'code' in e?String(e.code):'';
   const unknown=saved||(repository.mode==='supabase'&&(!code||code.startsWith('PGRST')||code==='57014'));
   setUncertain(unknown);setStale(!unknown&&(code==='40001'||/Loan changed/.test(friendlyError(e))));
   setError(unknown?'The result could not be confirmed. Retry this same request safely; it will not create a duplicate.':friendlyError(e));
   if(!unknown)pending.current=null;
   await refresh().catch(()=>{});
  }finally{lock.current=false;setBusy(false);}
 }};
}
function CheckoutDialog({db,itemId,refresh,close}:{db:Database;itemId?:string;refresh:()=>Promise<void>;close:()=>void}){
 const tools=db.items.filter(i=>i.itemType==='Tool'),[selected,setSelected]=useState(itemId??''),[from,setFrom]=useState(''),[to,setTo]=useState(''),form=useToolSubmit(refresh,close);
 const item=tools.find(i=>i.id===selected),eligible=db.locations.filter(l=>l.active!==false&&!l.tripId&&l.classification!=='travel');
 const have=(id:string)=>db.logistics?availableToolQuantity(db,selected,id):(item?.locationId===id?item.quantity:0);
 const sources=eligible.filter(l=>have(l.id)>0),source=from||sources[0]?.id||'',available=have(source);
 return <CreationModal heading="Check out tool" close={close} busy={form.busy}><form onSubmit={e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);void form.submit('checkout',{itemId:selected,from:source,to,quantity:Number(f.get('quantity')),borrower:String(f.get('borrower')??'').trim(),project:String(f.get('project')??'').trim(),expectedReturn:String(f.get('expectedReturn')??''),note:String(f.get('note')??'').trim()});
 }}>
  <fieldset disabled={form.busy||form.uncertain} className="checkout-fields"><div className="form-grid">
   <label className="full">Tool<select aria-label="Tool to check out" required value={selected} onChange={e=>{setSelected(e.target.value);setFrom('');setTo('');}}><option value="">Choose a tool</option>{tools.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
   <label>From location<select aria-label="Checkout from location" required value={source} onChange={e=>{setFrom(e.target.value);setTo('');}}>{!sources.length&&<option value="">No available tools</option>}{sources.map(l=><option key={l.id} value={l.id}>{locationPath(db.locations,l.id)} · {have(l.id)} available</option>)}</select></label>
   <label>Tool location<select aria-label="Checked-out tool location" required value={to} onChange={e=>setTo(e.target.value)}><option value="">Choose location</option>{eligible.filter(l=>l.id!==source).map(l=><option key={l.id} value={l.id}>{locationPath(db.locations,l.id)}</option>)}</select></label>
   <label>Who has the tool<input name="borrower" required maxLength={160} placeholder="Name of person responsible"/></label>
   <label>Project / purpose<input name="project" maxLength={200} placeholder="Robot assembly, practice, repairs…"/></label>
   <label>Quantity<input name="quantity" type="number" min="1" max={available} step="1" defaultValue="1" required/></label>
   <label>Expected return<input name="expectedReturn" type="date" required defaultValue={localDate()}/></label>
   <label className="full">Checkout note<textarea name="note" rows={2}/></label>
  </div></fieldset>
  {selected&&<p className="field-help">{available} available at the source. Existing loans and trip approvals are excluded. Travel tools use the trip manifest.</p>}
  {form.error&&<p role="alert">{form.error}</p>}
  <div className="modal-actions"><button type="button" className="secondary" disabled={form.busy} onClick={close}>Cancel</button><button className="primary" disabled={form.busy||!selected||(!form.uncertain&&available<1)}>{form.busy?'Saving…':form.uncertain?'Retry same checkout':'Confirm checkout'}</button></div>
 </form></CreationModal>;
}
function LoanDialog({db,loan:initialLoan,action,refresh,close}:{db:Database;loan:ToolLoan;action:Exclude<ToolAction,'checkout'>;refresh:()=>Promise<void>;close:()=>void}){
 const [loan,setLoan]=useState(initialLoan),form=useToolSubmit(refresh,close),latest=db.logistics?.toolLoans?.find(l=>l.id===loan.id),isReturn=action==='return',title=isReturn?'Return tools':action==='mark_missing'?'Mark tool missing':'Mark tool found';
 return <CreationModal heading={title} close={close} busy={form.busy}>
  <p><b>{db.items.find(i=>i.id===loan.itemId)?.name}</b> · {loan.borrower}</p><p>{outstandingQuantity(loan)} outstanding at {locationPath(db.locations,loan.locationId)}.</p>
  {isReturn?<p>Return to {locationPath(db.locations,loan.homeLocationId)}.</p>:<p>Changing missing status keeps the loan open and preserves the owned total. Its balance stays at the last known location until it is found and returned.</p>}
  <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void form.submit(action,{loanId:loan.id,updatedAt:loan.updatedAt,...(isReturn?{quantity:Number(f.get('quantity'))}:{}),note:String(f.get('note')??'').trim()});}}>
   <fieldset key={loan.updatedAt} className="checkout-fields" disabled={form.busy||form.uncertain||form.stale}>
    {isReturn&&<label>Quantity to return<input name="quantity" type="number" min="1" max={outstandingQuantity(loan)} step="1" defaultValue={outstandingQuantity(loan)} required/></label>}
    <label>{isReturn?'Return note':'Status note'}<textarea name="note" rows={3} required={!isReturn}/></label>
   </fieldset>
   {form.error&&<p role="alert">{form.error}</p>}
   {form.stale&&latest&&<p role="status">Latest outstanding: {outstandingQuantity(latest)}. {outstandingQuantity(latest)>0?<button type="button" className="secondary" disabled={form.busy||latest.updatedAt===loan.updatedAt} onClick={()=>{setLoan(latest);form.reviewLatest();}}>Review latest loan</button>:'This loan has already been fully returned.'}</p>}
   <div className="modal-actions"><button type="button" className="secondary" disabled={form.busy} onClick={close}>Cancel</button><button className="primary" disabled={form.busy||form.stale}>{form.busy?'Saving…':form.uncertain?'Retry same request':isReturn?'Confirm return':title}</button></div>
  </form>
 </CreationModal>;
}
