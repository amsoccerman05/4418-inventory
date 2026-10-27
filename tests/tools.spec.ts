import { test, expect } from '@playwright/test';
import { demo, migrateItem, missingTools, status, filterRestock, locationPath, verifyDrawer, exportCsv, importCsv, addToolDemo } from '../src/data';
const key='frc-4418-inventory-v1';
test.beforeEach(async ({page})=>{
 await page.addInitScript(({key,data})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(data));},{key,data:demo()});
});
const readDb=(page:import('@playwright/test').Page)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);

test('tool completeness is separate from stock health and target',()=>{
 const db=demo();const tool=db.items.find(i=>i.name==='5/32" Allen wrench')!;
 expect(tool.quantity).toBe(3);expect(tool.expectedQuantity).toBe(4);expect(tool.target).toBe(6);
 expect(missingTools(tool)).toBe(true);expect(status(tool)).toBe('GOOD');
 expect(filterRestock([tool])).toHaveLength(0);
 expect(missingTools({...tool,quantity:4})).toBe(false);
 expect(status({...tool,quantity:2})).toBe('LOW');
 expect(status({...tool,quantity:0})).toBe('OUT');
 expect(db.locations.filter(l=>l.kind==='Drawer')).toHaveLength(30);
 expect(locationPath(db.locations,'cl-l-01')).toBe('Storage Closet → Left Side → Shelf 1 → CL-L-01');
 const timestamp='2026-09-08T12:00:00Z';const audited=verifyDrawer(db,'ta-01',timestamp);
 expect(audited.items.filter(i=>i.locationId==='ta-01').every(i=>i.lastVerified===timestamp)).toBe(true);
 expect(audited.items.find(i=>i.id===tool.id)!.quantity).toBe(3);
 expect(audited.items.find(i=>i.locationId==='tb-01')).toEqual(db.items.find(i=>i.locationId==='tb-01'));
 const old={...tool};delete (old as Partial<typeof tool>).expectedQuantity;delete (old as Partial<typeof tool>).itemType;delete (old as Partial<typeof tool>).ownership;
 expect(migrateItem(old).expectedQuantity).toBeNull();
 expect(importCsv(exportCsv([tool]),db)[0]).toMatchObject({itemType:'Tool',ownership:'Shared / School',expectedQuantity:4,slot:'5/32',target:6});
 expect(()=>importCsv(exportCsv([tool]).replace('"Shared / School"','"Someone else"'),db)).toThrow('unknown ownership');
 expect(()=>importCsv(exportCsv([tool]).replace('"Tool"','"Unknown type"'),db)).toThrow('unknown itemType');
 expect(addToolDemo(db).items.length).toBe(db.items.length);
});

test('TA-01 opens an audit, edits instantly, and verifies only that drawer',async({page})=>{
 await page.goto('/#location/ta-01');
 await expect(page.getByRole('heading',{name:'TA-01 — SAE Hex Keys',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Drawer audit',exact:true})).toBeVisible();
 await expect(page.locator('.audit-row')).toHaveCount(6);
 const row=page.locator('.audit-row').filter({has:page.getByRole('button',{name:'5/32" Allen wrench',exact:true})});
 await expect(row).toContainText('Missing tools');
 await expect(row).not.toContainText('Out of stock');
 const count=row.getByLabel('Current quantity for 5/32" Allen wrench');
 await count.fill('4');await count.press('Enter');
 await expect(row).toContainText('Complete');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(count).toHaveValue('3');
 await row.getByRole('button',{name:'Add one 5/32" Allen wrench',exact:true}).click();
 const before=await readDb(page);
 await page.getByRole('button',{name:'Mark drawer verified'}).click();
 const after=await readDb(page);
 expect(after.items.filter((i:{locationId:string;lastVerified:string})=>i.locationId==='ta-01').every((i:{lastVerified:string})=>Date.now()-Date.parse(i.lastVerified)<10000)).toBe(true);
 expect(after.items.filter((i:{locationId:string})=>i.locationId==='tb-01')).toEqual(before.items.filter((i:{locationId:string})=>i.locationId==='tb-01'));
 await expect(page.locator('.audit-summary')).toContainText('2 tools missing');
 await page.reload();await expect(count).toHaveValue('4');
 await page.screenshot({path:'test-results/drawer-desktop.png',fullPage:true});
});

test('hierarchical cards open children and retain quantity controls',async({page})=>{
 await page.goto('/#locations');
 await page.getByRole('button').filter({has:page.getByRole('heading',{name:'Toolbox A — Mechanical / General',exact:true})}).click();
 await expect(page.locator('.location-card')).toHaveCount(15);
 await page.getByRole('button').filter({has:page.getByRole('heading',{name:'TA-01',exact:true})}).click();
 await expect(page).toHaveURL(/#location\/ta-01$/);
 await page.getByRole('button',{name:'View inventory',exact:true}).click();
 await expect(page.locator('tbody tr')).toHaveCount(6);
 await page.getByLabel('Search location inventory').fill('5/32');
 await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:'Drawer audit',exact:true}).click();
 await expect(page.locator('.audit-row')).toHaveCount(6);
 await page.getByRole('button',{name:'View inventory',exact:true}).click();
 await page.getByRole('button',{name:'Add one 5/32" Allen wrench',exact:true}).click();
 expect((await readDb(page)).items.find((i:{name:string})=>i.name==='5/32" Allen wrench').quantity).toBe(4);
 await page.goto('/#location/storage-closet');
 await page.getByRole('button').filter({has:page.getByRole('heading',{name:'Left Side',exact:true})}).click();
 await page.getByRole('button').filter({has:page.getByRole('heading',{name:'Shelf 1',exact:true})}).click();
 await page.getByRole('button').filter({has:page.getByRole('heading',{name:'CL-L-01',exact:true})}).click();
 await expect(page.locator('tbody')).toContainText('Safety glasses — spare stock');
});

test('item fields and inventory filters persist independently',async({page})=>{
 await page.goto('/#inventory');
 await page.locator('summary').filter({hasText:/Filters/}).click();
 await page.getByLabel('Filter by item type').selectOption('Tool');
 await page.getByLabel('Filter by ownership').selectOption('BEST');
 await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:'BEST practice field measuring tape',exact:true}).click();
 await expect(page.getByLabel('Item type',{exact:true})).toHaveValue('Tool');
 await page.locator('summary').filter({hasText:/More details/}).click();
 await page.getByLabel('Expected quantity',{exact:true}).fill('2');
 await page.getByLabel('Target quantity (overall)',{exact:true}).fill('5');
 await page.getByLabel('Slot / Position (optional)').fill('T-02');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.reload();
 const saved=(await readDb(page)).items.find((i:{name:string})=>i.name==='BEST practice field measuring tape');
 expect(saved).toMatchObject({expectedQuantity:2,target:5,slot:'T-02',ownership:'BEST'});
 await expect(page.locator('details.inventory-filters')).toHaveAttribute('open','');
 await expect(page.getByLabel('Filter by item type')).toHaveValue('Tool');
 await expect(page.getByLabel('Filter by ownership')).toHaveValue('BEST');
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await page.getByLabel('Filter by stock status').selectOption('MISSING');
 await expect(page.locator('tbody')).toContainText('5/32" Allen wrench');
});

test('new hierarchical drawers can be configured and receive items',async({page})=>{
 await page.goto('/#admin');
 await page.getByLabel('Parent location').selectOption('toolbox-a');
 await page.getByLabel('Location type').selectOption('Drawer');
 await page.getByLabel('Name / Code').fill('TA-16');
 await page.getByLabel('Contents / Description').fill('Practice tools');
 await page.getByRole('button',{name:'Add location',exact:true}).click();
 const created=(await readDb(page)).locations.find((l:{name:string})=>l.name==='TA-16');
 expect(created.parentId).toBe('toolbox-a');
 await page.goto(`/#location/${created.id}`);
 await page.getByRole('button',{name:'Add item',exact:true}).click();
 await page.getByLabel('Item name *').fill('Practice wrench');
 await expect(page.getByLabel('Item type',{exact:true})).toHaveValue('Tool');
 await expect(page.getByLabel('Location / Bin')).toHaveValue(created.id);
 await page.getByLabel('Current quantity *',{exact:true}).fill('1');
 await page.locator('summary').filter({hasText:/More details/}).click();
 await page.getByLabel('Expected quantity',{exact:true}).fill('2');
 await page.getByRole('dialog').getByRole('button',{name:'Add item',exact:true}).click();
 await expect(page.locator('.audit-row')).toContainText('Practice wrench');
 await expect(page.locator('.audit-row')).toContainText('Missing tools');
});

test('mobile audit and local official branding render correctly',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/#location/ta-01');
 await expect(page.locator('.audit-row')).toHaveCount(6);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.getByRole('button',{name:'Add one 5/32" Allen wrench',exact:true}).click();
 await expect(page.locator('.quantity-toast')).toContainText('4 each');
 await page.screenshot({path:'test-results/drawer-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Toggle navigation'}).click();
 const logo=page.locator('.suite-brand img');
 await expect(logo).toBeVisible();
 expect(await logo.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 expect(await logo.getAttribute('src')).toContain('branding/4418-impulse-emblem.png');
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();
 // The production design system hides decorative artwork below 950px.
 await expect(page.getByAltText('IMPULSE — FRC Team 4418')).toBeHidden();
 await expect(logo).toBeVisible();
 await page.setViewportSize({width:1440,height:900});
 await expect(page.getByAltText('IMPULSE — FRC Team 4418')).toBeVisible();
});

test('drawer save failure leaves verification dates unchanged',async({page})=>{
 await page.goto('/#location/ta-01');const before=await readDb(page);
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('Storage full');};});
 await page.getByRole('button',{name:'Mark drawer verified'}).click();
 await expect(page.getByRole('alert')).toContainText('Storage full');
 expect(await readDb(page)).toEqual(before);
});

test('production assets and direct drawer links work at the custom domain root',async({page})=>{
 await page.goto('/#location/ta-01');
 await page.reload();
 await expect(page.getByRole('heading',{name:'TA-01 — SAE Hex Keys',exact:true})).toBeVisible();
 const logo=page.locator('.suite-brand img');
 expect(await logo.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0&&new URL(img.src).pathname.startsWith('/branding/'))).toBe(true);
 await page.getByRole('button',{name:'Add one 5/32" Allen wrench',exact:true}).click();
 await expect(page.locator('.quantity-toast')).toContainText('4 each');
});
