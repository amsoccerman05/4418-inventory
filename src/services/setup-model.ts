import {needsVerification, type Database, type Item, type Location} from '../data';
import {atLocation} from './logistics-model';

export const restockPolicies = ['unset', 'restock', 'do_not_restock'] as const;
export type RestockPolicy = typeof restockPolicies[number];
export const restockPolicy = (item: Item): RestockPolicy => item.restockPolicy ?? 'unset';
export function validateRestock(policy: RestockPolicy, minimum: number, target: number): string {
  if (!restockPolicies.includes(policy)) return 'Choose a restock policy.';
  if (![minimum, target].every(n => Number.isFinite(n) && n >= 0)) return 'Enter nonnegative, finite thresholds.';
  if (policy === 'restock' && target <= minimum) return 'Target stock must be greater than the minimum.';
  return '';
}
export function countLocations(db: Database, item: Item): Item[] {
  if (!db.logistics) return [item];
  const ids = [...new Set([item.locationId, ...db.logistics.balances.filter(b => b.itemId === item.id && b.quantity > 0).map(b => b.locationId)])].filter(Boolean);
  return ids.map(id => atLocation(db, item, id));
}
export const unassignedLocationId = '44180000-0000-4000-8000-000000000099';
export function countableSetupLocation(db:Database,item:Item):boolean {const location=db.locations.find(l=>l.id===item.locationId);return !!location && location.id!==unassignedLocationId && location.active!==false && !location.tripId;}
export function setupReasons(db: Database, item: Item): string[] {
  const reasons: string[] = [];
  if (countLocations(db, item).filter(i=>countableSetupLocation(db,i)).some(needsVerification)) reasons.push('Count and verify');
  if (restockPolicy(item) === 'unset') reasons.push('Choose restock policy');
  if (!countableSetupLocation(db,item)) reasons.push('Choose home location');
  if (!item.unit.trim()) reasons.push('Set counting unit');
  return reasons;
}
export function locationScanUrl(location: Location, currentUrl: string): string {
  const url = new URL(currentUrl);
  url.search = '';
  url.hash = `location/${encodeURIComponent(location.id)}`;
  return url.href;
}
export function resolveLocationScan(input: string, locations: Location[], currentUrl: string): Location {
  const value = input.trim();
  if (!value || value.length > 512) throw new Error('Scan a location label or enter its printed code.');
  let id = '';
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value), current = new URL(currentUrl);
    if (url.origin !== current.origin || url.pathname !== current.pathname || url.search || !url.hash.startsWith('#location/')) throw new Error('That link is not a location in this workspace.');
    try { id = decodeURIComponent(url.hash.slice(10)); } catch { throw new Error('That location link is invalid.'); }
  }
  const matches = locations.filter(l => id ? l.id === id : l.labelCode?.toUpperCase() === value.toUpperCase());
  if (matches.length !== 1) throw new Error('Location label not found. Check the printed code and refresh the workspace.');
  if (matches[0].active === false) throw new Error('This location is archived. Ask a mentor to review its label.');
  return matches[0];
}
