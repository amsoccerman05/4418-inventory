import {test,expect} from './browser-fixtures';
import {blankItem,type Database} from '../src/data';
import {enableLogistics,localAction} from '../src/services/logistics-local';
import {atLocation,unaccounted} from '../src/services/logistics-model';
test.setTimeout(60000);
const initial=():Database=>enableLogistics({version:1,areas:[{id:'fabrication',name:'Fabrication',lead:''}],categories:['Tools'],locations:[{id:'home',name:'TA-01',bin:'TA-01',room:'Lab',storage:'Toolbox',kind:'Drawer'},{id:'project',name:'Shooter Prototype',bin:'PROJ',room:'Lab',storage:'Project',kind:'Storage',classification:'project'}],items:[{...blankItem(),id:'motor',name:'Kraken X60',quantity:8,minimum:4,target:8,locationId:'home',areaId:'fabrication',category:'Tools'},{...blankItem(),id:'wrench',name:'5/32" Allen Wrench',quantity:4,expectedQuantity:4,minimum:2,target:6,itemType:'Tool',locationId:'home',areaId:'fabrication',category:'Tools'},{...blankItem(),id:'drill',name:'School Drill',quantity:2,expectedQuantity:2,minimum:0,target:2,itemType:'Tool',ownership:'Shared / School',locationId:'home',areaId:'fabrication',category:'Tools'}]});
test.beforeEach(async({page})=>{await page.addInitScript(db=>{if(!localStorage.getItem('frc-4418-inventory-v1'))localStorage.setItem('frc-4418-inventory-v1',JSON.stringify(db));},initial());});
test('project movement preserves total and location correction changes only that balance',async({page})=>{
 await page.goto('/#inventory');await page.getByRole('button',{name:'Move Kraken X60',exact:true}).click();await page.getByLabel('To location',{exact:true}).selectOption('project');await page.getByLabel('Quantity to move').fill('2');await page.getByRole('button',{name:'Move inventory',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);const row=page.locator('tbody tr').filter({has:page.getByRole('button',{name:'Kraken X60',exact:true})});await expect(row.locator('.stepper b')).toHaveText('8');await expect(row).toContainText('2 Shooter Prototype');
 await page.goto('/#location/project');await expect(page.locator('tbody .stepper b')).toHaveText('2');await page.getByRole('button',{name:'Remove one Kraken X60',exact:true}).click();await expect(page.locator('tbody .stepper b')).toHaveText('1');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('tbody .stepper b')).toHaveText('2');
 await page.goto('/#restock');await expect(page.getByRole('button',{name:'Kraken X60',exact:true})).toHaveCount(0);
});
test('drawer distinguishes assigned elsewhere from unaccounted',async({page})=>{
 await page.goto('/#inventory');await page.getByRole('button',{name:'Move 5/32" Allen Wrench',exact:true}).click();await page.getByLabel('To location',{exact:true}).selectOption('project');await page.getByRole('button',{name:'Move inventory',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.goto('/#location/home');let row=page.locator('.audit-row').filter({has:page.getByRole('button',{name:'5/32" Allen Wrench',exact:true})});await expect(row).toContainText('1 assigned elsewhere');await expect(row).toContainText('0 unaccounted');await expect(row).not.toContainText('Missing tools');
 await page.goto('/#location/project');await page.getByRole('button',{name:'Remove one 5/32" Allen Wrench',exact:true}).click();await expect(page.locator('.quantity-toast')).toContainText('0 each');await page.goto('/#location/home');row=page.locator('.audit-row').filter({has:page.getByRole('button',{name:'5/32" Allen Wrench',exact:true})});await expect(row).toContainText('1 unaccounted');await expect(row).toContainText('Missing tools');
});
test('school drill trip packs, splits internal locations, returns and closes on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/#travel');await page.getByRole('button',{name:'New trip',exact:true}).first().click();await page.getByLabel('Trip name',{exact:true}).fill('2026 Denver Regional');await page.getByRole('button',{name:'Create trip',exact:true}).click();await page.getByRole('button',{name:/2026 Denver Regional/}).click();await page.getByLabel('Trip status').selectOption('packing');
 await page.getByLabel('Manifest item').selectOption('drill');await page.getByLabel('Approved quantity').fill('2');await page.getByRole('button',{name:'Approve for packing',exact:true}).click();await page.getByRole('button',{name:'Pack',exact:true}).click();await page.getByRole('button',{name:'Confirm pack',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'Move within trip',exact:true}).click();await page.getByLabel('Allocation quantity').fill('1');await page.getByLabel('Allocation destination').selectOption({label:'2026 Denver Regional → Pit Toolbox B'});await page.getByRole('button',{name:'Confirm internal',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.manifest-row')).toHaveCount(2);
 await page.getByLabel('Trip status').selectOption('closed');await expect(page.getByRole('alert')).toContainText('Unresolved');await page.getByRole('button',{name:'Dismiss error'}).click();
 await page.getByRole('button',{name:'Return Audit',exact:true}).click();await page.getByLabel('Filter trip ownership').selectOption('Shared / School');await expect(page.locator('.return-summary')).toContainText('0/2 returned');
 for(let n=0;n<2;n++){await page.getByRole('button',{name:'Return home',exact:true}).first().click();await page.getByRole('button',{name:'Confirm return',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}
 await expect(page.locator('.return-summary')).toContainText('2/2 returned');await page.getByLabel('Trip status').selectOption('closed');await expect(page.getByLabel('Trip status')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
test('accounting helper preserves a single item and exposes a loss',()=>{
 let db=localAction(initial(),'move',{itemId:'wrench',from:'home',to:'project',quantity:1});let item=db.items.find(i=>i.id==='wrench')!;expect(db.items).toHaveLength(3);expect(unaccounted(atLocation(db,item,'home'))).toBe(0);
 db=localAction(db,'adjust',{itemId:'wrench',from:'project',quantity:0,updatedAt:item.updatedAt});item=db.items.find(i=>i.id==='wrench')!;expect(unaccounted(atLocation(db,item,'home'))).toBe(1);expect(item.quantity).toBe(3);
});

test('creation dialogs and trip groups remain usable across screen sizes',async({page})=>{
 for(const width of [1440,1280,768,390]){
  await page.setViewportSize({width,height:900});await page.goto('/#travel');
  await expect(page.getByRole('heading',{name:'No trips yet'})).toBeVisible();await expect(page.getByLabel('Trip name')).toHaveCount(0);
  await page.getByRole('button',{name:'New trip',exact:true}).first().click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByLabel('Trip name')).toBeFocused();await page.screenshot({path:`test-results/new-trip-${width}.png`,fullPage:true});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/#locations');await expect(page.getByLabel('Location name')).toHaveCount(0);await page.getByRole('button',{name:'Add location',exact:true}).click();await expect(page.getByLabel('Instructions')).toBeVisible();await page.screenshot({path:`test-results/new-location-${width}.png`,fullPage:true});await page.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
 await page.goto('/#travel');await page.getByRole('button',{name:'New trip',exact:true}).first().click();await page.getByLabel('Trip name').fill('2027 Denver Regional — competition equipment and school tools');await page.getByRole('button',{name:'Create trip',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Upcoming trips'})).toBeVisible();await expect(page.getByRole('heading',{name:'Completed trips'})).toHaveCount(0);await page.screenshot({path:'test-results/travel-mobile.png',fullPage:true});
 for(const name of ['Offseason demonstration — shared equipment','Pikes Peak Regional']){await page.getByRole('button',{name:'New trip',exact:true}).click();await page.getByLabel('Trip name').fill(name);await page.getByRole('button',{name:'Create trip',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}
 await page.getByRole('button',{name:/Pikes Peak Regional.*Open trip/}).click();await page.getByLabel('Trip status').selectOption('packing');await page.getByRole('button',{name:'All trips',exact:true}).click();await expect(page.locator('.travel-group').first()).toContainText('Active trips');
 for(const width of [1440,1280,768,390]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`test-results/travel-cards-${width}.png`,fullPage:true});}

});
