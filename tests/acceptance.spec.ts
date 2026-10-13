import { test, expect, type Page } from './browser-fixtures';
import { demo, type Database } from '../src/data';
const key='frc-4418-inventory-v1';
const name='5/32" Allen wrench';
const readDb=(page:Page):Promise<Database>=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
const rowFor=(page:Page,itemName:string)=>page.locator('.audit-row').filter({has:page.getByRole('button',{name:itemName,exact:true})});

test.beforeEach(async({page})=>{
 await page.addInitScript(({key,db})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(db));},{key,db:demo()});
});

test('removing several tools distinguishes missing, low, and out',async({page})=>{
 await page.goto('/#location/ta-01');
 const row=rowFor(page,name);
 await expect(row).toContainText('Missing tools');
 await expect(row).not.toContainText('Low stock');
 await expect(row).not.toContainText('Out of stock');
 await row.getByRole('button',{name:`Remove one ${name}`,exact:true}).click();
 await expect(row).toContainText('Missing tools');await expect(row).toContainText('Low stock');
 await expect(row).not.toContainText('Out of stock');
 await row.getByRole('button',{name:`Remove one ${name}`,exact:true}).click();
 await row.getByRole('button',{name:`Remove one ${name}`,exact:true}).click();
 await expect(row).toContainText('Missing tools');await expect(row).toContainText('Out of stock');
 await expect(row).not.toContainText('Low stock');
 await rowFor(page,'5/64" Allen wrench').getByRole('button',{name:'Remove one 5/64" Allen wrench',exact:true}).click();
 await expect(rowFor(page,'5/64" Allen wrench')).toContainText('Missing tools');
 await page.reload();expect((await readDb(page)).items.find(i=>i.name===name)!.quantity).toBe(0);
});

test('moving between drawers preserves ID and updates both hierarchies',async({page})=>{
 await page.goto('/#location/ta-01');await expect(rowFor(page,name)).toBeVisible();const before=await readDb(page);expect(before.locations.every(location=>!!location.labelCode)).toBe(true);const item=before.items.find(i=>i.name===name)!;
 await page.getByRole('button',{name,exact:true}).click();
 await page.getByLabel('Location / Bin').selectOption('tb-15');
 await page.getByLabel('Slot / Position (optional)').fill('B-05');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(rowFor(page,name)).toHaveCount(0);
 await page.goto('/#location/tb-15');await expect(rowFor(page,name)).toBeVisible();
 await expect(rowFor(page,name)).toContainText('Slot B-05');
 const after=await readDb(page);expect(after.items.find(i=>i.id===item.id)).toMatchObject({locationId:'tb-15',slot:'B-05',expectedQuantity:4,target:6,quantity:3});
 expect(after.items.length).toBe(before.items.length);expect(after.locations).toEqual(before.locations);
 await page.goto('/#location/toolbox-a');await expect(page.locator('tbody').getByRole('button',{name,exact:true})).toHaveCount(0);
 await page.goto('/#location/toolbox-b');await expect(page.locator('tbody').getByRole('button',{name,exact:true})).toBeVisible();
 await page.reload();await expect(page.locator('tbody').getByRole('button',{name,exact:true})).toBeVisible();
});

test('duplicate Allen wrench size is obvious before and after adding',async({page})=>{
 await page.goto('/#location/ta-01');await page.getByRole('button',{name:'Add item',exact:true}).click();
 await page.getByLabel('Item name *').fill(name);
 await page.getByLabel('Current quantity *',{exact:true}).fill('1');
 await page.getByLabel('Expected quantity',{exact:true}).fill('1');
 await expect(page.getByRole('dialog').getByText('Possible duplicate', {exact:false})).toBeVisible();
 await expect(page.getByRole('dialog').getByRole('button',{name:'View existing item',exact:true})).toBeVisible();
 await page.getByRole('dialog').getByRole('button',{name:'Add item',exact:true}).click();
 await expect(rowFor(page,name)).toHaveCount(2);
 for(const row of await rowFor(page,name).all())await expect(row).toContainText('Possible duplicate');
});

test('current 3, expected 4, target 6 remain distinct in audit and details',async({page})=>{
 await page.goto('/#location/ta-01');await page.getByRole('button',{name,exact:true}).click();
 await page.getByLabel('Current quantity *',{exact:true}).fill('3');
 await page.getByLabel('Expected quantity',{exact:true}).fill('4');
 await page.getByLabel('Target quantity (overall)',{exact:true}).fill('6');
 await expect(page.getByText('Expected: how many belong in this drawer or location. Leave blank if not yet known.')).toBeVisible();
 await expect(page.getByText('Target: how many the team ideally wants to own overall, including spares elsewhere.')).toBeVisible();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 const row=rowFor(page,name);await expect(row.getByLabel(`Current quantity for ${name}`)).toHaveValue('3');
 await expect(row.locator('.expected-count')).toHaveText('/ 4');
 await expect(row).toContainText('Target (overall): 6');
 await expect(row).toContainText('Missing tools');await expect(row).not.toContainText('Low stock');
});

test('a 20-line drawer stays quick to navigate, correct, and verify',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await page.evaluate(key=>{
  const db=JSON.parse(localStorage.getItem(key)!);const seed=db.items.find((i:{name:string})=>i.name==='5/32" Allen wrench');
  db.items=db.items.filter((i:{locationId:string})=>i.locationId!=='ta-01');
  for(let n=1;n<=20;n++)db.items.push({...seed,id:`audit-test-${n}`,name:`${n}/64" Allen wrench`,slot:`${n}/64`,quantity:n%5===0?3:4,expectedQuantity:4,target:6});
  localStorage.setItem(key,JSON.stringify(db));
 },key);
 await page.reload();
 await page.goto('/#location/ta-01');await expect(page.locator('.audit-row')).toHaveCount(20);
 await expect(page.locator('.audit-summary')).toContainText('4 tools missing');
 const start=Date.now();
 for(let n=5;n<=20;n+=5){
  await page.getByRole('button',{name:'Next missing',exact:true}).click();
  const active=page.locator('.audit-quantity:focus');await expect(active).toHaveValue('3');
  await active.fill('4');await active.press('Enter');
 }
 await expect(page.locator('.audit-summary')).toContainText('Complete');
 await page.getByRole('button',{name:'Mark drawer verified',exact:true}).click();
 const elapsed=Date.now()-start;
 await testInfo.attach('automated-audit-timing',{body:`20 rows; four corrections plus verification: ${elapsed} ms. This measures UI interactions, not physical counting or human usability.`,contentType:'text/plain'});
 expect(elapsed).toBeLessThan(20000);
 await expect(page.locator('.audit-row')).toHaveCount(20);
 expect((await readDb(page)).items.filter(i=>i.locationId==='ta-01').every(i=>i.quantity===4&&Date.now()-Date.parse(i.lastVerified)<10000)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:testInfo.outputPath('20-item-drawer.png'),fullPage:true});
});

test('CSV export and re-import preserve IDs and all relationships without duplicates',async({page})=>{
 await page.goto('/#admin');await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeVisible();const before=await readDb(page);
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();
 const download=await downloading;const path=await download.path();expect(path).toBeTruthy();
 await page.locator('input[type=file]').setInputFiles(path!);
 await expect(page.getByRole('status')).toContainText('Imported');
 const after=await readDb(page);
 expect(after.items.length).toBe(before.items.length);
 expect(after.items.map(i=>i.id).sort()).toEqual(before.items.map(i=>i.id).sort());
 expect(after.items).toEqual(before.items);expect(after.locations).toEqual(before.locations);expect(after.areas).toEqual(before.areas);
 await page.locator('input[type=file]').setInputFiles(path!);
 await expect(page.getByRole('status')).toContainText('Imported');
 expect((await readDb(page)).items).toEqual(before.items);
 await page.reload();await page.goto('/#location/ta-01');await expect(page.locator('.audit-row')).toHaveCount(6);
});
