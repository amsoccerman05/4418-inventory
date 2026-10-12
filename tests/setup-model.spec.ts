import {test, expect} from '@playwright/test';
import {demo, filterRestock, exportCsv, importCsv} from '../src/data';
import {countableSetupLocation, locationScanUrl, resolveLocationScan, setupReasons, validateRestock} from '../src/services/setup-model';
test('setup never infers no-restock from zeros, and explicit choices survive CSV', () => {
 const db=demo(), item={...db.items[0],minimum:0,target:0,quantity:0,lastVerified:'',restockPolicy:'unset' as const};
 expect(setupReasons(db,item)).toContain('Choose restock policy');expect(filterRestock([item])).toHaveLength(1);
 const noRestock={...item,restockPolicy:'do_not_restock' as const};expect(filterRestock([noRestock])).toHaveLength(0);
 expect(importCsv(exportCsv([noRestock]),db)[0].restockPolicy).toBe('do_not_restock');
 expect(validateRestock('restock',0,0)).toContain('greater');expect(validateRestock('restock',0,1)).toBe('');
 expect(validateRestock('restock',NaN,3)).toContain('finite');expect(validateRestock('do_not_restock',0,0)).toBe('');
});
test('location scans are exact, local navigation only and reject archived or foreign links', () => {
 const l={...demo().locations[0],labelCode:'L-123456ABCDEF'}, base='https://inventory.frc4418.org/?secret=not-for-labels#setup';
 expect(locationScanUrl(l,base)).toBe('https://inventory.frc4418.org/#location/e-04');
 expect(resolveLocationScan(' l-123456abcdef\r\n',[l],base).id).toBe(l.id);
 expect(resolveLocationScan(locationScanUrl(l,base),[l],base).id).toBe(l.id);
 expect(()=>resolveLocationScan('https://evil.example/#location/e-04',[l],base)).toThrow('not a location');
 expect(()=>resolveLocationScan('L-123456ABCDEF',[{...l,active:false}],base)).toThrow('archived');
 expect(()=>resolveLocationScan('L-123456ABCDEF',[l,l],base)).toThrow('not found');
 expect(()=>resolveLocationScan('12345',[l],base)).toThrow('not found');
});

test('unassigned and travel balances cannot be falsely marked ready or counted through setup',()=>{
 const db=demo(),item=db.items[0],placeholder='44180000-0000-4000-8000-000000000099';
 db.locations.push({id:placeholder,name:'Unassigned',room:'',storage:'',bin:''});
 const unassigned={...item,locationId:placeholder,lastVerified:new Date().toISOString(),restockPolicy:'do_not_restock' as const};
 expect(setupReasons(db,unassigned)).toContain('Choose home location');expect(countableSetupLocation(db,unassigned)).toBe(false);
 db.locations.push({id:'travel-test',name:'Pit',room:'',storage:'',bin:'',tripId:'trip-test'});
 expect(countableSetupLocation(db,{...item,locationId:'travel-test'})).toBe(false);
});
