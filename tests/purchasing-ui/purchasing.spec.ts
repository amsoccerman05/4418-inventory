import {test,expect} from '@playwright/test';
const path='/tests/purchasing-ui/harness.html';
test('configure → request → draft → two approvals → partial receiving survives reload',async({page})=>{
 await page.goto(path);await page.getByLabel('Find restock item').fill('NEO Vortex');
 await page.getByRole('button',{name:'Purchasing setup for NEO Vortex'}).click();const setup=page.getByRole('dialog');
 await setup.getByLabel('Purchase unit',{exact:true}).fill('box');await setup.getByLabel('each per purchase unit').fill('2');await setup.getByLabel('Estimated cost').fill('20');
 await setup.getByRole('button',{name:'Purchasing setup',exact:true}).click();await expect(setup).toBeHidden();
 await page.getByRole('button',{name:'Request NEO Vortex',exact:true}).click();const request=page.getByRole('dialog');await request.getByLabel('Purchase packs').fill('3');await expect(request).toContainText('Request 6 each total');await request.getByRole('button',{name:'Request restock',exact:true}).click();
 await page.getByRole('button',{name:'Create Finance draft',exact:true}).click();const draft=page.getByRole('dialog');await draft.getByLabel('PO total').fill('65');await draft.getByRole('button',{name:'Create Finance draft',exact:true}).click();
 await expect(page.getByRole('button',{name:'Record placed order'})).toBeDisabled();
 await page.getByRole('button',{name:'Demo: Finance lead approves',exact:true}).click();await page.getByRole('button',{name:'Demo: Lead coach approves',exact:true}).click();await page.getByRole('button',{name:'Demo: School submits',exact:true}).click();
 await page.getByRole('button',{name:'Record placed order',exact:true}).click();await page.getByRole('dialog').getByLabel('Supplier order reference').fill('DEMO-123');await page.getByRole('dialog').getByRole('button',{name:'Record placed order',exact:true}).click();
 await page.getByRole('button',{name:'Receive delivery',exact:true}).click();const receive=page.getByRole('dialog');await receive.getByLabel('Received each',{exact:true}).fill('2');await receive.getByLabel('Unique delivery').fill('DEMO-SLIP-1');await receive.getByRole('button',{name:'Receive delivery',exact:true}).click();
 await expect(page.locator('.purchasing-request')).toContainText('Received 2 of 6 each');await expect(page.locator('.purchasing-request')).toContainText('4 still due');
 await page.reload();await page.getByLabel('Find restock item').fill('NEO Vortex');await expect(page.locator('.purchasing-request')).toContainText('Received 2 of 6 each');
 await page.getByRole('button',{name:'Receive delivery',exact:true}).click();await page.getByRole('dialog').getByLabel('Received each',{exact:true}).fill('2');await page.getByRole('dialog').getByLabel('Unique delivery').fill('DEMO-SLIP-1');await page.getByRole('dialog').getByRole('button',{name:'Receive delivery',exact:true}).click();await expect(page.locator('.purchasing-error')).toContainText('already been received');await page.getByRole('dialog').getByRole('button',{name:'Back',exact:true}).click();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('frc-4418-inventory-v1')!));expect(saved.items.find((i:{name:string})=>i.name==='NEO Vortex').quantity).toBe(5);expect(saved.purchasing.receipts).toHaveLength(1);
 await page.screenshot({path:'test-results/purchasing-desktop.png',fullPage:true});
});
test('closing setup leaves no request or stock change, mobile has no page overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(path);await page.getByLabel('Find restock item').fill('NEO Vortex');await page.getByRole('button',{name:'Purchasing setup for NEO Vortex'}).click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeHidden();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('frc-4418-inventory-v1')!).purchasing)).toBeUndefined();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/purchasing-mobile.png',fullPage:true});
});
