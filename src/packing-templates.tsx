import {useEffect,useRef,useState} from 'react';
import {locationPath,type Database} from './data';
import {createId} from './utils/id';
import type {UserProfile} from './services/types';
import {packingRepository} from './services/packing-repository';
import {friendlyError} from './services/supabase';
import {availableForPacking,canManagePacking,plannedTripLines,reviewPackingLines,type PackingTemplate,type PackingSource,type ReviewedPackingLine} from './services/packing-model';
import './packing-templates.css';

/** Drop-in panel: no routing, global repository or physical movement API changes. */
export function PackingTemplates({db,profile,tripId,refresh}:{db:Database;profile:UserProfile;tripId:string;refresh:()=>Promise<void>}){
 const [templates,setTemplates]=useState<PackingTemplate[]>([]),[ready,setReady]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [source,setSource]=useState(''),[review,setReview]=useState<{source:PackingSource;name:string;lines:ReviewedPackingLine[];requestId:string}|null>(null);
 const [checked,setChecked]=useState(false),[name,setName]=useState(''),[saving,setSaving]=useState(false),[busy,setBusy]=useState(false);
 const running=useRef(false),saveRequest=useRef({name:'',source:'',id:''});
 const trip=db.logistics?.trips.find(t=>t.id===tripId),manager=canManagePacking(profile),canApprove=!!trip&&['planning','packing'].includes(trip.status);
 useEffect(()=>{let active=true;setReady(false);void packingRepository.list().then(rows=>{if(active){setTemplates(rows);setReady(true);}}).catch(e=>{if(active)setError(typeof e==='object'&&e!==null&&'code' in e&&['42P01','PGRST205'].includes(String(e.code))?'Reusable packing templates are not available in this workspace yet. Existing trip tools still work.':friendlyError(e));});return()=>{active=false;};},[tripId,db]);
 useEffect(()=>{setSource('');setReview(null);setChecked(false);setError('');setMessage('');setName('');},[tripId]);
 if(!trip||!db.logistics)return null;
 const previousTrips=db.logistics.trips.filter(t=>t.id!==tripId&&t.status==='closed'&&plannedTripLines(db,t.id).length>0);
 const planned=plannedTripLines(db,tripId);
 function update(index:number,change:Partial<ReviewedPackingLine>){
  setChecked(false);setReview(r=>r?{...r,requestId:createId(),lines:r.lines.map((l,i)=>i===index?{...l,...change}:l)}:r);
 }
 function startReview(){
  setError('');setMessage('');setChecked(false);
  const isTemplate=source.startsWith('template:'),id=source.slice(source.indexOf(':')+1),template=templates.find(t=>t.id===id),previous=previousTrips.find(t=>t.id===id);
  const lines=isTemplate?template?.lines:previous?plannedTripLines(db,previous.id):undefined;
  if(!lines?.length){setError('Choose an available template or closed trip');return;}
  setReview({source:isTemplate?{templateId:id}:{sourceTripId:id},name:isTemplate?template!.name:previous!.name,lines:reviewPackingLines(db,lines),requestId:createId()});
 }
 const problem=(line:ReviewedPackingLine)=>{
  if(!db.items.some(i=>i.id===line.itemId))return 'Item no longer available';
  if(!Number.isFinite(line.quantity)||line.quantity<=0)return 'Enter a quantity greater than zero';
  if(!db.locations.some(l=>l.id===line.homeLocationId&&l.active!==false&&!l.tripId))return 'Select an active home';
  if(!db.locations.some(l=>l.id===line.destinationId&&l.active!==false&&l.tripId===tripId))return 'Select a destination';
  const total=review?.lines.filter(l=>l.itemId===line.itemId&&l.homeLocationId===line.homeLocationId).reduce((n,l)=>n+l.quantity,0)??line.quantity;
  return total>availableForPacking(db,line.itemId,line.homeLocationId).available?'Not enough available stock for these lines':'';
 };
 return <section className="packing-templates" aria-label="Reusable packing templates"><div className="panel-heading"><div><h3>Reusable packing templates</h3><p>Bring a planned kit into review. Quantities and locations are checked before approval; packing remains a separate step.</p></div></div>
 {!manager?<p>Ask a lead, admin or mentor to save or approve a reusable kit.</p>:<>
 {planned.length>0&&trip.status!=='cancelled'&&<form className="packing-save" onSubmit={async e=>{e.preventDefault();if(running.current)return;running.current=true;setSaving(true);setError('');setMessage('');const label=name.trim();if(saveRequest.current.name!==label||saveRequest.current.source!==tripId)saveRequest.current={name:label,source:tripId,id:createId()};try{await packingRepository.action('save',{requestId:saveRequest.current.id,name:label,sourceTripId:tripId});setTemplates(await packingRepository.list());setReady(true);setName('');saveRequest.current={name:'',source:'',id:''};setMessage('Planned kit saved as a reusable template.');await refresh();}catch(e){setError(friendlyError(e));}finally{running.current=false;setSaving(false);}}}><label>Template name<input value={name} required maxLength={100} onChange={e=>setName(e.target.value)} placeholder="Regional pit kit"/></label><button className="secondary" disabled={!ready||saving||busy||!name.trim()}>{saving?'Saving…':'Save planned kit'}</button><small>Saves the intended quantities from this trip, including any split allocations. No packing or return state is saved.</small></form>}
 {canApprove&&<><div className="packing-source"><label>Start from a saved kit or closed trip<select aria-label="Packing source" value={source} disabled={busy||saving||!ready} onChange={e=>setSource(e.target.value)}><option value="">Choose a source</option><optgroup label="Saved templates">{templates.map(t=><option key={t.id} value={`template:${t.id}`}>{t.name}</option>)}</optgroup><optgroup label="Closed previous trips">{previousTrips.map(t=><option key={t.id} value={`trip:${t.id}`}>{t.name}</option>)}</optgroup></select></label><button type="button" className="secondary" disabled={!source||busy||saving||!ready} onClick={startReview}>Review planned kit</button></div>
 {ready&&!templates.length&&!previousTrips.length&&<small>No reusable kits yet. Approve your first planned list, then save it above.</small>}
 {review&&<form className="packing-review" onSubmit={async e=>{e.preventDefault();if(running.current)return;running.current=true;setBusy(true);setError('');setMessage('');try{await packingRepository.action('approve',{...review.source,requestId:review.requestId,tripId,lines:review.lines,reviewed:checked});setReview(null);setChecked(false);setMessage('Reviewed kit approved. Use the existing Pack buttons when you physically pack it.');await refresh();}catch(e){setError(friendlyError(e));await refresh().catch(()=>{});}finally{running.current=false;setBusy(false);}}}>
 <h4>Review: {review.name}</h4><p>Choose each destination for this trip. Availability subtracts all outstanding approvals; it is checked again when you approve.</p>
 {review.lines.map((line,index)=>{const item=db.items.find(i=>i.id===line.itemId),availability=availableForPacking(db,line.itemId,line.homeLocationId);return <fieldset key={index} disabled={busy}><legend>{item?.name||'Unavailable item'}</legend><div className="form-grid"><label>Planned quantity<input aria-label={`Planned quantity ${index+1}`} type="number" min="0.001" step="any" required value={line.quantity} onChange={e=>update(index,{quantity:Number(e.target.value)})}/></label><label>Home / source<select aria-label={`Packing home ${index+1}`} required value={line.homeLocationId} onChange={e=>{const homeLocationId=e.target.value;update(index,{homeLocationId,itemUpdatedAt:item?.updatedAt??'',balanceUpdatedAt:db.logistics!.balances.find(b=>b.itemId===line.itemId&&b.locationId===homeLocationId)?.updatedAt??''});}}><option value="">Choose home</option>{db.locations.filter(l=>!l.tripId&&l.active!==false).map(l=><option key={l.id} value={l.id}>{locationPath(db.locations,l.id)}</option>)}</select></label><label>Trip destination<select aria-label={`Packing destination ${index+1}`} required value={line.destinationId} onChange={e=>update(index,{destinationId:e.target.value})}><option value="">Choose destination</option>{db.locations.filter(l=>l.tripId===tripId&&l.active!==false).map(l=><option key={l.id} value={l.id}>{locationPath(db.locations,l.id)}</option>)}</select></label><div><strong>{availability.available} available</strong><small>{availability.have} at source · {availability.planned} already approved · {availability.loaned} on loan</small>{problem(line)&&<small className="packing-warning">{problem(line)}</small>}</div></div><button type="button" className="text-button" onClick={()=>{setChecked(false);setReview(r=>r?{...r,requestId:createId(),lines:r.lines.filter((_,i)=>i!==index)}:r);}}>Remove from this review</button></fieldset>;})}
 <label className="packing-confirm"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>I reviewed the quantities, source locations, trip destinations and current availability.</label>
 <div className="button-row"><button type="button" className="secondary" disabled={busy} onClick={()=>{setReview(null);setChecked(false);}}>Cancel review</button><button type="button" className="secondary" disabled={busy} onClick={()=>{setReview(r=>r?{...r,requestId:createId(),lines:reviewPackingLines(db,r.lines).map((l,i)=>({...l,destinationId:r.lines[i].destinationId}))}:r);setChecked(false);setError('');}}>Refresh review</button><button className="primary" disabled={busy||saving||!checked||!review.lines.length||review.lines.some(l=>!!problem(l))}>{busy?'Approving…':'Approve reviewed kit'}</button></div>
 </form>}</>}
 </>}
 {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
