import { test, expect } from './browser-fixtures';
import { demo, exportCsv, importCsv, mergeImportedItems, possibleDuplicates } from '../src/data';

test('CSV preserves identity, accepts legacy rows, and rejects broken references atomically',()=>{
 const db=demo();const item=db.items.find(i=>i.name==='5/32" Allen wrench')!;
 expect(importCsv(exportCsv([item]),db)[0]).toEqual(item);
 const minimal=`id,name,areaId,category,quantity\n${item.id},Updated wrench,fabrication,Mechanical tools,2`;
 const updated=importCsv(minimal,db)[0];
 expect(updated).toMatchObject({id:item.id,quantity:2,locationId:item.locationId,expectedQuantity:4,target:6,ownership:item.ownership,lastVerified:item.lastVerified});
 const merged=mergeImportedItems(db,[updated]);expect(merged.items).toHaveLength(db.items.length);
 expect(merged.items.find(i=>i.id===item.id)!.name).toBe('Updated wrench');expect(merged.locations).toBe(db.locations);
 const legacy=importCsv('name,areaId,category,quantity\nNew wrench,fabrication,Tools,1',db)[0];
 expect(db.items.some(i=>i.id===legacy.id)).toBe(false);
 expect(mergeImportedItems(db,[legacy]).items).toHaveLength(db.items.length+1);
 expect(()=>importCsv(exportCsv([item,item]),db)).toThrow('duplicate item ID');
 expect(()=>importCsv(exportCsv([{...item,locationId:'missing-drawer'}]),db)).toThrow('unknown locationId');
 expect(()=>importCsv(exportCsv([{...item,areaId:'missing-area'}]),db)).toThrow('unknown areaId');
 const notes={...item,notes:'Comma, "quotes", and\nmultiline notes'};
 expect(importCsv(exportCsv([notes]),db)[0]).toEqual(notes);
});

test('duplicate detection respects ownership and physical location',()=>{
 const db=demo();const item=db.items.find(i=>i.name==='5/32" Allen wrench')!;
 expect(possibleDuplicates(db.items,{...item,id:'another',name:'  5/32″   ALLEN WRENCH  '})).toEqual([item]);
 expect(possibleDuplicates(db.items,{...item,id:'another',locationId:'tb-01'})).toEqual([]);
 expect(possibleDuplicates(db.items,{...item,id:'another',ownership:'BEST'})).toEqual([]);
 expect(possibleDuplicates(db.items,item)).toEqual([]);
});
