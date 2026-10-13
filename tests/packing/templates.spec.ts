import {test,expect} from '@playwright/test';
import {blankItem,type Database} from '../../src/data';
import {enableLogistics,localAction} from '../../src/services/logistics-local';
import {packingLocalAction} from '../../src/services/packing-local';
import {plannedTripLines,reviewPackingLines} from '../../src/services/packing-model';
import {demoProfile} from '../../src/services/types';
const seed=()=>{
 let db:Database=enableLogistics({version:1,areas:[{id:'area',name:'Mechanical',lead:''}],categories:['Tools'],locations:[{id:'home',name:'Toolbox A',bin:'TA',room:'Lab',storage:'',kind:'Storage'}],items:[{...blankItem(),id:'drill',name:'School drill',quantity:4,expectedQuantity:4,minimum:0,target:4,locationId:'home',areaId:'area',category:'Tools',ownership:'Shared / School'}]});
 db=localAction(db,'create_trip',{name:'Previous regional'});const prior=db.logistics!.trips[0].id,to=db.locations.find(l=>l.tripId===prior&&l.name==='Trailer')!.id;
 db=localAction(db,'approve',{tripId:prior,itemId:'drill',quantity:2,from:'home',to});const mid=db.logistics!.manifest[0].id;
 db=localAction(db,'trip_status',{tripId:prior,status:'packing'});db=localAction(db,'pack',{manifestId:mid,quantity:2});db=localAction(db,'return',{manifestId:mid,quantity:1});db=localAction(db,'return',{manifestId:mid,quantity:1});db=localAction(db,'trip_status',{tripId:prior,status:'closed'});
 db=localAction(db,'create_trip',{name:'Next regional'});return {db,prior,next:db.logistics!.trips.at(-1)!.id};
};
test('demo model rejects restricted roles, preserves source state and retries safely',()=>{
 const {db,prior,next}=seed(),save={requestId:'save-1',name:'Pit kit',sourceTripId:prior};
 for(const role of ['student','readonly'] as const)expect(()=>packingLocalAction(db,{...demoProfile,role},'save',save)).toThrow(/lead/);
 expect(()=>packingLocalAction(db,{...demoProfile,active:false},'save',save)).toThrow(/lead/);
 const saved=packingLocalAction(db,demoProfile,'save',save);expect(saved.db.logistics!.balances).toEqual(db.logistics!.balances);expect(saved.db.logistics!.movements).toEqual(db.logistics!.movements);
 expect(saved.db.logistics!.packing!.templates[0].lines).toEqual([{itemId:'drill',quantity:2,homeLocationId:'home'}]);
 expect(packingLocalAction(saved.db,demoProfile,'save',save).db.logistics!.packing!.templates).toHaveLength(1);
 const lines=reviewPackingLines(saved.db,plannedTripLines(saved.db,prior)).map(l=>({...l,destinationId:db.locations.find(p=>p.tripId===next&&p.name==='Trailer')!.id}));
 const cmd={requestId:'approve-1',templateId:saved.result.id,tripId:next,lines,reviewed:true};
 const approved=packingLocalAction(saved.db,demoProfile,'approve',cmd);expect(approved.db.logistics!.balances).toEqual(db.logistics!.balances);
 expect(approved.db.logistics!.manifest.filter(m=>m.tripId===next).map(m=>m.status)).toEqual(['approved']);
 expect(packingLocalAction(approved.db,demoProfile,'approve',cmd).result).toEqual(approved.result);
 expect(()=>packingLocalAction(saved.db,demoProfile,'approve',{...cmd,lines:[lines[0],{...lines[0],quantity:3}]})).toThrow(/Not enough/);
});
test('save, review, cancel, availability, approve and physical packing stay separate on mobile',async({page})=>{
 const {db,prior,next}=seed();await page.addInitScript(db=>localStorage.setItem('frc-4418-inventory-v1',JSON.stringify(db)),db);
 await page.setViewportSize({width:390,height:844});await page.goto('/#trip/'+prior);
 await page.getByLabel('Template name',{exact:true}).fill('Regional pit kit');await page.getByRole('button',{name:'Save planned kit',exact:true}).click();await expect(page.locator('.packing-templates [role="status"]')).toContainText('saved');
 await page.getByRole('button',{name:'All trips',exact:true}).click();await page.getByRole('button',{name:/Next regional.*Open trip/}).click();
 const selector=page.getByLabel('Packing source',{exact:true});await selector.selectOption({label:'Regional pit kit'});await page.getByRole('button',{name:'Review planned kit',exact:true}).click();
 await expect(page.getByLabel('Planned quantity 1',{exact:true})).toHaveValue('2');await expect(page.getByLabel('Packing destination 1',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'Cancel review',exact:true}).click();await expect(page.locator('.packing-review')).toHaveCount(0);await expect(page.locator('.manifest-row')).toHaveCount(0);
 await page.getByRole('button',{name:'Review planned kit',exact:true}).click();await page.getByLabel('Packing destination 1',{exact:true}).selectOption({label:'Next regional → Trailer'});
 await page.getByLabel('Planned quantity 1',{exact:true}).fill('99');await expect(page.locator('.packing-warning')).toContainText('Not enough');await expect(page.getByRole('button',{name:'Approve reviewed kit',exact:true})).toBeDisabled();
 await page.getByLabel('Planned quantity 1',{exact:true}).fill('2');await page.getByRole('checkbox',{name:/I reviewed/}).check();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:'test-results/packing-review-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Approve reviewed kit',exact:true}).dblclick();await expect(page.locator('.manifest-row')).toHaveCount(1);await expect(page.locator('.manifest-row')).toContainText('Approved');await expect(page.getByRole('button',{name:'Pack',exact:true})).toHaveCount(0);
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('frc-4418-inventory-v1')!));expect(state.logistics.balances.filter((b:any)=>b.quantity>0)).toHaveLength(1);expect(state.logistics.manifest.filter((m:any)=>m.tripId===next)).toHaveLength(1);
 await page.getByLabel('Trip status').selectOption('packing');await page.getByRole('button',{name:'Pack',exact:true}).click();await page.getByRole('button',{name:'Confirm pack',exact:true}).click();await expect(page.locator('.manifest-row')).toContainText('Packed');
});
test('copy a closed trip opens review only and Back/Forward do not submit it',async({page})=>{
 const {db,prior,next}=seed();await page.addInitScript(db=>localStorage.setItem('frc-4418-inventory-v1',JSON.stringify(db)),db);await page.goto('/#trip/'+next);
 await page.getByLabel('Packing source',{exact:true}).selectOption('trip:'+prior);await page.getByRole('button',{name:'Review planned kit',exact:true}).click();await expect(page.locator('.manifest-row')).toHaveCount(0);
 await page.getByRole('button',{name:'All trips',exact:true}).click();await page.goBack();await expect(page.locator('.packing-review')).toHaveCount(0);await expect(page.locator('.manifest-row')).toHaveCount(0);
});
