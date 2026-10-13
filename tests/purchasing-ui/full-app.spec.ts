import {test,expect} from '@playwright/test';
import {demo} from '../../src/data';
import {localPurchasingAction} from '../../src/services/purchasing-local';
const storageKey='frc-4418-inventory-v1';
test('actual Restock screen supports deliberate legacy reconciliation and a Finance draft',async({page})=>{
 const base=demo(),item={...base.items.find(i=>i.name==='NEO Vortex')!,orderStatus:'Ordered' as const};
 const seeded=localPurchasingAction({...base,items:[item]},'configure',{item_id:item.id,version:0,supplier:item.vendor,purchase_unit:'box',units_per_pack:2,pack_cost:20});
 await page.addInitScript(({storageKey,seeded})=>{if(!localStorage.getItem(storageKey))localStorage.setItem(storageKey,JSON.stringify(seeded));},{storageKey,seeded});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#restock');await expect(page.getByRole('heading',{name:'Keep the build moving.',exact:true})).toBeVisible();
 const purchasing=page.getByRole('region',{name:'Restock purchasing'});await expect(purchasing).toBeVisible();await expect(purchasing).toContainText('Legacy quantity unknown');
 await purchasing.getByRole('button',{name:'Request NEO Vortex',exact:true}).click();await page.getByRole('dialog').getByLabel('Purchase packs').fill('3');await page.getByRole('dialog').getByRole('button',{name:'Request restock',exact:true}).click();
 await expect(purchasing.getByRole('button',{name:'Create Finance draft',exact:true})).toBeDisabled();
 await purchasing.getByRole('button',{name:'Review legacy order status for NEO Vortex'}).click();
 await page.getByRole('dialog').getByRole('combobox',{name:'Legacy order status',exact:true}).selectOption('Needs Order');await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 let saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),storageKey);expect(saved.items[0].orderStatus).toBe('Ordered');expect(saved.items[0].quantity).toBe(3);expect(saved.purchasing.pos).toHaveLength(0);
 await purchasing.getByRole('button',{name:'Review legacy order status for NEO Vortex'}).click();
 await expect(page.getByRole('dialog')).toContainText('Review the existing order before changing this legacy flag');await page.getByRole('dialog').getByRole('combobox',{name:'Legacy order status',exact:true}).selectOption('Needs Order');await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeHidden();await expect(purchasing.getByRole('button',{name:'Create Finance draft',exact:true})).toBeEnabled();
 saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),storageKey);expect(saved.items[0].orderStatus).toBe('Needs Order');expect(saved.items[0].quantity).toBe(3);expect(saved.purchasing.pos).toHaveLength(0);expect(saved.purchasing.requests).toHaveLength(1);
 await purchasing.getByRole('button',{name:'Create Finance draft',exact:true}).click();await page.getByRole('dialog').getByLabel('PO total').fill('65');await page.getByRole('dialog').getByRole('button',{name:'Create Finance draft',exact:true}).click();await expect(purchasing).toContainText('Demo PO #1');
 await page.reload();await expect(page.getByRole('region',{name:'Restock purchasing'})).toContainText('Demo PO #1');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  if(width===390)await expect.poll(()=>page.locator('.sidebar').evaluate(element=>element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`test-results/purchasing-full-app-${width}.png`,fullPage:true,animations:'disabled'});
 }
 expect(errors).toEqual([]);
});
