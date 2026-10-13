import {test, expect} from './browser-fixtures';
import {demo, filterRestock, exportCsv, importCsv} from '../src/data';
import {countableSetupLocation, setupReasons, validateRestock} from '../src/services/setup-model';
test('setup never infers no-restock from zeros, and explicit choices survive CSV', () => {
 const db=demo(), item={...db.items[0],minimum:0,target:0,quantity:0,lastVerified:'',restockPolicy:'unset' as const};
 expect(setupReasons(db,item)).toContain('Choose restock policy');expect(filterRestock([item])).toHaveLength(1);
 const noRestock={...item,restockPolicy:'do_not_restock' as const};expect(filterRestock([noRestock])).toHaveLength(0);
 expect(importCsv(exportCsv([noRestock]),db)[0].restockPolicy).toBe('do_not_restock');
 expect(validateRestock('restock',0,0)).toContain('greater');expect(validateRestock('restock',0,1)).toBe('');
 expect(validateRestock('restock',NaN,3)).toContain('finite');expect(validateRestock('do_not_restock',0,0)).toBe('');
});
test('unassigned and travel balances cannot be falsely marked ready or counted through setup',()=>{
 const db=demo(),item=db.items[0],placeholder='44180000-0000-4000-8000-000000000099';
 db.locations.push({id:placeholder,name:'Unassigned',room:'',storage:'',bin:''});
 const unassigned={...item,locationId:placeholder,lastVerified:new Date().toISOString(),restockPolicy:'do_not_restock' as const};
 expect(setupReasons(db,unassigned)).toContain('Choose home location');expect(countableSetupLocation(db,unassigned)).toBe(false);
 db.locations.push({id:'travel-test',name:'Pit',room:'',storage:'',bin:'',tripId:'trip-test'});
 const travelHome={...item,locationId:'travel-test',lastVerified:new Date().toISOString(),restockPolicy:'do_not_restock' as const};
 expect(countableSetupLocation(db,travelHome)).toBe(false);expect(setupReasons(db,travelHome)).toContain('Choose home location');
});
