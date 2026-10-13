import {needsVerification, type Database, type Item} from '../data';
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
