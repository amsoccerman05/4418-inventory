import {useState} from 'react';
import {ArrowRight, Check} from 'lucide-react';
import {locationPath, needsVerification, type Database, type Item} from './data';
import {canCount, canEdit, type UserProfile} from './services/types';
import {countLocations, countableSetupLocation, restockPolicy, setupReasons, validateRestock, type RestockPolicy} from './services/setup-model';
import './setup.css';

export function SetupSummary({db, go}: {db: Database; go: (path: string) => void}) {
  const pending = db.items.filter(i => setupReasons(db, i).length);
  if (!pending.length) return null;
  return <section className="panel setup-summary"><div><span className="eyebrow">A RELIABLE START</span><h2>Finish setup <span className="count">{pending.length}</span></h2><p>Count what’s on the shelf, then choose how each item should be restocked.</p></div><button className="primary" onClick={() => go('setup')}>Review setup <ArrowRight size={16}/></button></section>;
}

function CountStep({item, db, busy, allowed, verify}: {item: Item; db: Database; busy: boolean; allowed: boolean; verify: (item: Item, quantity: number) => Promise<boolean>}) {
  const [count, setCount] = useState(''), [confirmed, setConfirmed] = useState(false);
  return <form className="setup-count-row" onSubmit={async e => {e.preventDefault(); if (count.trim() && confirmed && await verify(item, Number(count))) {setCount(''); setConfirmed(false);}}}>
    <div><b>{locationPath(db.locations, item.locationId)}</b><small>{item.quantity} {item.unit} recorded here · {needsVerification(item) ? 'Count due' : 'Verified ' + new Date(item.lastVerified).toLocaleDateString()}</small></div>
    <label>Count here ({item.unit})<input aria-label={`Count ${item.name} at ${locationPath(db.locations, item.locationId)}`} type="number" min="0" step="any" required value={count} disabled={!allowed || busy} onChange={e => {setCount(e.target.value); setConfirmed(false);}} placeholder="Enter observed count"/></label>
    <label className="setup-check"><input type="checkbox" checked={confirmed} disabled={!allowed || busy || !count.trim()} onChange={e => setConfirmed(e.target.checked)}/>I physically counted this location</label>
    <button className="secondary" disabled={!allowed || busy || !confirmed || !count.trim() || !Number.isFinite(Number(count)) || Number(count) < 0}><Check size={16}/>Save verified count</button>
  </form>;
}

function RestockStep({item, busy, allowed, save}: {item: Item; busy: boolean; allowed: boolean; save: (item: Item, policy: RestockPolicy, minimum: number, target: number) => Promise<boolean>}) {
  const [policy, setPolicy] = useState<RestockPolicy>(restockPolicy(item)), [minimum, setMinimum] = useState(String(item.minimum)), [target, setTarget] = useState(String(item.target)), [message, setMessage] = useState('');
  const validation = minimum.trim() && target.trim() ? validateRestock(policy, Number(minimum), Number(target)) : 'Enter both thresholds.';
  return <form className="setup-policy" onSubmit={async e => {e.preventDefault(); if (validation || policy === 'unset') return; if (await save(item, policy, Number(minimum), Number(target))) setMessage('Restock settings saved.');}}>
    <h3>2. Choose a restock policy</h3><p>Zero thresholds do not mean “don’t restock.” Make that choice explicitly.</p>
    <label>Restock policy<select value={policy} disabled={!allowed || busy} onChange={e => {setPolicy(e.target.value as RestockPolicy);if(e.target.value==='do_not_restock'){setMinimum(String(item.minimum));setTarget(String(item.target));}setMessage('');}}><option value="unset">Choose a policy…</option><option value="restock">Restock when low</option><option value="do_not_restock">Don’t restock this item</option></select></label>
    {policy !== 'do_not_restock' && <div className="setup-thresholds"><label>Minimum stock ({item.unit})<input type="number" min="0" step="any" required value={minimum} disabled={!allowed || busy} onChange={e => setMinimum(e.target.value)}/></label><label>Target stock ({item.unit})<input type="number" min="0" step="any" required value={target} disabled={!allowed || busy} onChange={e => setTarget(e.target.value)}/></label></div>}
    {policy === 'do_not_restock' && <p>This removes the item from Restock. Its counts, missing-tool warnings and existing thresholds are kept.</p>}
    {policy === 'restock' && validation && <p className="field-help">{validation}</p>}
    {!allowed && <p className="field-help">An assigned area lead, admin or mentor can change restock settings.</p>}
    <button className="primary" disabled={!allowed || busy || policy === 'unset' || !!validation}>Save restock settings</button>{message && <p role="status">{message}</p>}
  </form>;
}

export function FinishSetup({db, profile, busy, edit, verify, save, go}: {db: Database; profile: UserProfile; busy: boolean; edit: (item: Item) => void; verify: (item: Item, quantity: number) => Promise<boolean>; save: (item: Item, policy: RestockPolicy, minimum: number, target: number) => Promise<boolean>; go: (path: string) => void}) {
  const [area, setArea] = useState(profile.role === 'lead' ? profile.primaryAreaId || '' : ''), [selected, setSelected] = useState(''), [showAll, setShowAll] = useState(false);
  const pending = db.items.filter(i => setupReasons(db, i).length), rows = (showAll ? db.items : pending).filter(i => !area || i.areaId === area);
  const item = db.items.find(i => i.id === selected);
  const ready = db.setupAvailable !== false;
  return <><div className="setup-progress"><strong>{db.items.length - pending.length} of {db.items.length} items ready</strong><progress max={Math.max(1, db.items.length)} value={db.items.length - pending.length}/><span>Existing records stay unchanged until you save a step.</span></div>
    {!ready && <p className="notice">Setup settings need the latest database update. Counting still uses the existing verified-count workflow.</p>}
    <div className="setup-layout"><section className="panel setup-queue"><div className="panel-heading"><h2>Setup queue</h2><span className="count">{rows.length}</span></div><div className="setup-filters"><label>Area<select value={area} onChange={e => setArea(e.target.value)}><option value="">All areas</option>{db.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label className="setup-check"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)}/>Show ready items too</label></div>
      <div className="setup-list">{rows.map(i => <button className={selected === i.id ? 'setup-item selected' : 'setup-item'} key={i.id} onClick={() => setSelected(i.id)}><b>{i.name}</b><small>{db.areas.find(a => a.id === i.areaId)?.name} · {i.unit || 'Unit needed'}</small><span>{setupReasons(db, i).join(' · ') || 'Ready'}</span></button>)}</div>{!rows.length && <div className="empty"><Check/><h3>Setup is up to date</h3><p>Use “Show ready items too” to review existing settings.</p></div>}</section>
      <section className="panel setup-detail">{item ? <><div className="panel-heading"><div><h2>{item.name}</h2><p>{locationPath(db.locations, item.locationId)}</p></div><button className="secondary" onClick={() => edit(item)}>Item details</button></div><h3>1. Count each location</h3><p>Enter the count you observed. Saving verifies only that location and keeps stock elsewhere separate.</p>{countLocations(db, item).map(i => {const location=db.locations.find(l=>l.id===i.locationId);return countableSetupLocation(db,i)?<CountStep key={`${i.id}-${i.locationId}-${i.updatedAt}`} item={i} db={db} busy={busy} allowed={canCount(profile)} verify={verify}/>:<div className="notice" key={i.locationId}><p>{i.quantity} {i.unit} recorded at {locationPath(db.locations,i.locationId)}.</p>{location?.tripId?<><p>Travel stock is accounted for through its trip manifest.</p><button className="text-button" onClick={()=>go(`trip/${location.tripId}`)}>Open trip</button></>:<p>Choose an active physical home in Item details before verifying this count.</p>}</div>;})}
        <RestockStep key={`${item.id}-${item.updatedAt}`} item={item} busy={busy} allowed={ready && canEdit(profile, item.areaId)} save={save}/>
        <div className="setup-details"><h3>3. Check the details</h3><p>Unit: <b>{item.unit || 'Not set'}</b> · Type: <b>{item.itemType}</b></p><p>Check the home location, unit and item type in Item details. Tools can also have an expected drawer count.</p>{item.locationId && <button className="text-button" onClick={() => go(`location/${item.locationId}`)}>Open location audit <ArrowRight size={14}/></button>}</div></> : <div className="empty"><Check/><h3>One item at a time</h3><p>Choose an item from the queue to count it and finish its settings.</p></div>}</section></div></>;
}
