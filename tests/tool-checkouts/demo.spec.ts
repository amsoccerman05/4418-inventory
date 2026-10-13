import {test,expect} from '../browser-fixtures';
import {demo,missingTools} from '../../src/data';
import {atLocation} from '../../src/services/logistics-model';
import {enableLogistics,localAction,syncLocalBalances} from '../../src/services/logistics-local';
import {localToolAction} from '../../src/services/tool-checkouts-local';
import {availableToolQuantity,outstandingQuantity} from '../../src/services/tool-checkouts-model';
const key='frc-4418-inventory-v1',path='/#checkouts';
const fixture=()=>{const db=enableLogistics(demo());db.logistics!.toolLoans=[];return db;};
test('model preserves owned total and enforces loan-specific returns and generic guards',()=>{
 const db=fixture(),tool=db.items.find(i=>i.name==='Digital calipers')!;const data={operationId:'checkout-1',itemId:tool.id,from:tool.locationId,to:'p-01',quantity:2,borrower:'Test teammate',expectedReturn:'2026-12-31'};
 let next=localToolAction(db,'checkout',data);const loan=next.logistics!.toolLoans![0];expect(next.items.find(i=>i.id===tool.id)!.quantity).toBe(3);expect(availableToolQuantity(next,tool.id,'p-01')).toBe(0);expect(missingTools(atLocation(next,next.items.find(i=>i.id===tool.id)!,tool.locationId))).toBe(false);expect(localToolAction(next,'checkout',data)).toEqual(next);
 expect(()=>localAction(next,'move',{itemId:tool.id,from:'p-01',to:tool.locationId,quantity:1})).toThrow('Outstanding tool loans');
 expect(()=>localAction(next,'adjust',{itemId:tool.id,from:'p-01',quantity:0,updatedAt:next.items.find(i=>i.id===tool.id)!.updatedAt})).toThrow('Outstanding tool loans');
 expect(()=>syncLocalBalances(next,{...next,items:next.items.map(i=>i.id===tool.id?{...i,itemType:'Consumable'}:i)})).toThrow('Return outstanding');
 expect(()=>syncLocalBalances(next,{...next,locations:next.locations.map(l=>l.id===tool.locationId?{...l,active:false}:l)})).toThrow('Return outstanding');
 next=localToolAction(next,'mark_missing',{operationId:'missing',loanId:loan.id,updatedAt:loan.updatedAt,note:'Missing'});expect(next.items.find(i=>i.id===tool.id)!.quantity).toBe(3);
 const current=next.logistics!.toolLoans![0];next=localToolAction(next,'return',{operationId:'return',loanId:loan.id,updatedAt:current.updatedAt,quantity:1});expect(outstandingQuantity(next.logistics!.toolLoans![0])).toBe(1);expect(next.logistics!.toolLoans![0].status).toBe('missing');
 expect(()=>localToolAction(next,'return',{operationId:'stale',loanId:loan.id,updatedAt:current.updatedAt,quantity:1})).toThrow('Loan changed');
 const consumable=db.items.find(i=>i.itemType==='Consumable')!;expect(()=>localToolAction(db,'checkout',{...data,itemId:consumable.id,from:consumable.locationId})).toThrow('Only Tool');
});
test.describe('full app browser flows',()=>{
 test.beforeEach(async({page})=>{await page.addInitScript(({key,db})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(db));},{key,db:fixture()});});
 test('root navigation, checkout, partial return, missing/found, reload and final return',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Tool checkouts',exact:true}).click();await expect(page).toHaveURL(/#checkouts$/);await page.getByRole('button',{name:'Check out tool',exact:true}).click();
  await page.getByLabel('Tool to check out').selectOption({label:'Digital calipers'});await page.getByLabel('Checked-out tool location').selectOption('p-01');await page.getByLabel('Who has the tool').fill('Jordan Test');await page.getByLabel('Project / purpose').fill('Robot assembly');await page.getByLabel('Quantity',{exact:true}).fill('2');await page.getByLabel('Expected return').fill('2026-10-01');await page.getByRole('button',{name:'Confirm checkout',exact:true}).dblclick();await expect(page.getByRole('dialog')).toHaveCount(0);
  const loans=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).logistics.toolLoans,key);expect(loans).toHaveLength(1);await expect(page.getByText('Jordan Test',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Return tools',exact:true}).click();await page.getByLabel('Quantity to return').fill('1');await page.getByRole('button',{name:'Confirm return',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText('1 / 2',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Mark missing',exact:true}).click();await page.getByLabel('Status note').fill('Checking the assembly bench');await page.getByRole('dialog').getByRole('button',{name:'Mark tool missing',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.checkout-card .badge')).toHaveText('Missing');
  await page.reload();await expect(page.locator('.checkout-card .badge')).toHaveText('Missing');await page.getByRole('button',{name:'Mark found',exact:true}).click();await page.getByLabel('Status note').fill('Found under bench');await page.getByRole('dialog').getByRole('button',{name:'Mark tool found',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Return tools',exact:true}).click();await page.getByRole('button',{name:'Confirm return',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.checkout-card')).toHaveCount(0);await page.getByLabel('Filter tool loans').selectOption('returned');await expect(page.locator('.checkout-card .badge')).toHaveText('Returned');
  const db=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);expect(db.items.find((i:{name:string})=>i.name==='Digital calipers').quantity).toBe(3);expect(db.logistics.toolLoans[0].returnedQuantity).toBe(2);
 });
 test('cancel, escape, mobile layout and no fake demo loans',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(path);await expect(page.getByText('No tool loans yet',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Check out tool',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('button',{name:'Check out tool',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:'test-results/tool-checkouts-mobile.png',fullPage:true});
 });
});
