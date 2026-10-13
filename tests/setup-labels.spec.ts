import {PNG} from 'pngjs';
import {MultiFormatReader, BarcodeFormat, DecodeHintType, BinaryBitmap, HybridBinarizer, RGBLuminanceSource} from '@zxing/library';
import {test, expect, type Page} from './browser-fixtures';
import {demo} from '../src/data';
function decodeLabel(bytes:Buffer,format:BarcodeFormat){const png=PNG.sync.read(bytes),gray=new Uint8ClampedArray(png.width*png.height);for(let i=0;i<gray.length;i++)gray[i]=(png.data[i*4]+2*png.data[i*4+1]+png.data[i*4+2])/4;return new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(gray,png.width,png.height))),new Map([[DecodeHintType.POSSIBLE_FORMATS,[format]]])).getText();}
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
test('scan navigation is read-only; stable dual labels survive reload and print cleanly',async({page})=>{
 await page.goto('/#labels/e-04');await expect(page.locator('.location-label')).toHaveCount(1);await expect(page.locator('.location-barcode rect')).not.toHaveCount(0);
 const before=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key),code=before.locations.find((l:{id:string})=>l.id==='e-04').labelCode;
 await page.reload();await expect(page.getByRole('img',{name:`Code 128 ${code}`})).toBeVisible();
 expect(decodeLabel(await page.locator('.location-qr').screenshot(),BarcodeFormat.QR_CODE)).toBe('http://127.0.0.1:5174/#location/e-04');
 expect(decodeLabel(await page.locator('.location-barcode').screenshot(),BarcodeFormat.CODE_128)).toBe(code);
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/setup-labels-desktop.png',fullPage:true,animations:'disabled'});
 await page.emulateMedia({media:'print'});await expect(page.locator('.suite-header')).toBeHidden();await expect(page.locator('.location-label')).toBeVisible();await expect(page.getByRole('heading',{name:'Print location labels'})).toBeHidden();await page.screenshot({path:'test-results/setup-labels-print.png',fullPage:true,animations:'disabled'});await page.emulateMedia({media:'screen'});
 await page.goto('/#locations');await page.getByLabel('Scan location label').fill(code);await page.getByLabel('Scan location label').press('Enter');await expect(page).toHaveURL(/#location\/e-04$/);
 const after=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);expect(after.items).toEqual(before.items);
 await page.getByLabel('Scan location label').fill('123456789');await page.getByRole('button',{name:'Open location',exact:true}).click();await expect(page.getByRole('alert')).toContainText('not found');await expect(page).toHaveURL(/#location\/e-04$/);
});
test('setup and labels fit desktop and phone, including long item names',async({page})=>{
 await page.goto('/#setup');
 await page.evaluate(key=>{const db=JSON.parse(localStorage.getItem(key)!);db.items[0].name='Kraken X60 spare motor with integrated encoder for the drivebase development and competition repair kit';localStorage.setItem(key,JSON.stringify(db));},key);
 await page.reload();await page.getByRole('button',{name:/Kraken X60.*Count and verify/}).click();
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await settleMobileNavigation(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`test-results/setup-count-${width}.png`,fullPage:true,animations:'disabled'});}
 await page.goto('/#labels/e-04');await expect(page.locator('.location-label')).toBeVisible();await settleMobileNavigation(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:'test-results/setup-labels-phone.png',fullPage:true,animations:'disabled'});
});
