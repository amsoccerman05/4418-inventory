import {test, expect, type Page} from './browser-fixtures';
import {demo} from '../src/data';
const key = 'frc-4418-inventory-v1';
async function settleMobileNavigation(page:Page) {
 if ((page.viewportSize()?.width ?? 1440) <= 680) await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
}
test.beforeEach(async ({page}) => {const db=demo();db.items=db.items.slice(0,3).map(i=>({...i,minimum:0,target:0,lastVerified:'',restockPolicy:'unset'}));await page.addInitScript(({key,db})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(db));},{key,db});});
test('guided count requires a physical confirmation and keeps setup metadata separate',async({page})=>{
 await page.goto('/#setup');await page.getByRole('button',{name:/Kraken X60.*Count and verify/}).click();
 await expect(page.getByRole('button',{name:'Save verified count'})).toBeDisabled();
 await page.getByLabel('Count Kraken X60 at', {exact:false}).fill('7');await expect(page.getByRole('button',{name:'Save verified count'})).toBeDisabled();
 await page.getByLabel('I physically counted this location').check();await page.getByRole('button',{name:'Save verified count'}).click();
 await expect(page.getByText('Count saved and verified for this location.')).toBeVisible();
 const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).items[0],key);expect(saved.quantity).toBe(7);expect(saved.lastVerified).toBeTruthy();expect(saved.restockPolicy).toBe('unset');expect(saved.minimum).toBe(0);
 await page.getByRole('combobox',{name:'Restock policy',exact:true}).selectOption('do_not_restock');await page.getByRole('button',{name:'Save restock settings'}).click();
 await expect(page.getByText('1 of 3 items ready')).toBeVisible();
 await page.reload();await expect(page.getByText('1 of 3 items ready')).toBeVisible();
});
test('policy validates thresholds, reopening and cancel do not verify or mutate quantities',async({page})=>{
 await page.goto('/#setup');await page.getByRole('button',{name:/Kraken X60.*Count and verify/}).click();
 await page.getByRole('combobox',{name:'Restock policy',exact:true}).selectOption('restock');await expect(page.getByRole('button',{name:'Save restock settings'})).toBeDisabled();
 await page.getByLabel('Minimum stock (each)',{exact:true}).fill('2');await page.getByLabel('Target stock (each)',{exact:true}).fill('6');await page.getByRole('button',{name:'Save restock settings'}).click();
 await expect(page.locator('.setup-detail').getByRole('combobox',{name:'Restock policy',exact:true})).toHaveValue('restock');
 await page.getByRole('button',{name:'Item details',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).items[0],key);expect(saved.quantity).toBe(8);expect(saved.lastVerified).toBe('');expect(saved.target).toBe(6);
 await page.goto('/#locations');await page.goBack();await expect(page).toHaveURL(/#setup/);await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('setup fits desktop and phone, including long item names',async({page})=>{
 await page.goto('/#setup');
 await page.evaluate(key=>{const db=JSON.parse(localStorage.getItem(key)!);db.items[0].name='Kraken X60 spare motor with integrated encoder for the drivebase development and competition repair kit';localStorage.setItem(key,JSON.stringify(db));},key);
 await page.reload();await page.getByRole('button',{name:/Kraken X60.*Count and verify/}).click();
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await settleMobileNavigation(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`test-results/setup-count-${width}.png`,fullPage:true,animations:'disabled'});}
});

test('location and setup navigation leave saved data unchanged and expose no hardware tools',async({page})=>{
 await page.goto('/#setup');
 const before=await page.evaluate(key=>localStorage.getItem(key),key);
 for(const route of ['setup','inventory','locations','location/e-04','restock','travel','checkouts']){
  await page.goto('/#'+route);
  await expect(page.getByRole('heading',{level:1})).toBeVisible();
  await expect(page.getByLabel('Scan location label')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/print/i})).toHaveCount(0);
  await expect(page.locator('.location-qr,.location-barcode,.location-label')).toHaveCount(0);
 }
 expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(before);
 const locations=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).locations,key);
 expect(locations.every((location:Record<string,unknown>)=>!Object.hasOwn(location,'labelCode'))).toBe(true);
 await page.goto('/#location/e-04');await expect(page.getByRole('heading',{name:'Location inventory'})).toBeVisible();
 for(const route of ['labels','labels/e-04']){
  await page.goto('/#'+route);
  await expect(page.getByRole('heading',{name:'Everything in its place.',exact:true})).toBeVisible();
  await expect(page.locator('.labels-panel')).toHaveCount(0);
 }
 expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(before);
});

test('existing saved location fields survive loading and ordinary setup edits',async({page})=>{
 await page.goto('/#setup');
 await page.evaluate(key=>{const db=JSON.parse(localStorage.getItem(key)!);db.locations[0].labelCode='L-123456ABCDEF';localStorage.setItem(key,JSON.stringify(db));},key);
 const before=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
 await page.reload();
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key)).toEqual(before);
 await page.getByRole('button',{name:/Kraken X60.*Count and verify/}).click();
 await page.getByRole('combobox',{name:'Restock policy',exact:true}).selectOption('do_not_restock');
 await page.getByRole('button',{name:'Save restock settings'}).click();
 await expect(page.locator('.setup-detail').getByRole('combobox',{name:'Restock policy',exact:true})).toHaveValue('do_not_restock');
 const after=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
 expect(after.locations).toEqual(before.locations);
 expect(after.items.map((item:{quantity:number})=>item.quantity)).toEqual(before.items.map((item:{quantity:number})=>item.quantity));
});
