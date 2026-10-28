import {test, expect, type Page} from '@playwright/test';
import {demo, type Database} from '../src/data';

const dataKey = 'frc-4418-inventory-v1';
function fixture(): Database {
 const db = demo();
 const template = db.items.find(item => item.name === 'Kraken X60')!;
 db.items = [
  ['Bolt, hex 1/4-20', 'ABC-001'],
  ['Bolt, hex 1/4-200', 'ABC-0012'],
  ['Bolt, hex 1/40-20', 'ABC001'],
  ['Washer 5/32"', 'W-005'],
  ['Washer 5/320"', 'W-050'],
  ['Bracket M6', 'BR-006'],
 ].map(([name,partNumber],index) => ({...template,id:`search-feedback-${index}`,name,partNumber}));
 return db;
}
async function seed(page: Page, db = fixture()) {
 await page.addInitScript(({key, db}) => {if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(db));}, {key:dataKey, db});
}
const savedData = (page: Page) => page.evaluate(key => localStorage.getItem(key), dataKey);
const names = (page: Page) => page.locator('.inventory-results .item-link');
async function openFilters(page: Page) {
 const details=page.locator('details.inventory-filters');
 if(await details.getAttribute('open')===null)await details.locator('summary').click();
}

for(const width of [390,1440]) test(`search reorders words without substituting sizes or part numbers at ${width}px`, async({page}) => {
 await page.setViewportSize({width,height:844});await seed(page);await page.goto('/#inventory');
 const before=await savedData(page);const search=page.getByLabel('Search inventory');
 for(const [query,expected] of [
  ['hex bolt',['Bolt, hex 1/4-20','Bolt, hex 1/4-200','Bolt, hex 1/40-20']],
  ['HEX, bolt 1/4–20',['Bolt, hex 1/4-20']],
  ['bolt abc-001',['Bolt, hex 1/4-20']],
  ['ABC001',['Bolt, hex 1/40-20']],
  ['washer 5⁄32″',['Washer 5/32"']],
  ['washer 5',[]],
  ['bracket m6',['Bracket M6']],
  ['bracket 6',[]],
 ] as [string,string[]][]){await search.fill(query);await expect(names(page)).toHaveText(expected);}
 await search.fill('HEX, bolt 1/4–20');await openFilters(page);
 await page.getByLabel('Filter by item type',{exact:true}).selectOption('Part');
 await page.reload();await expect(search).toHaveValue('HEX, bolt 1/4–20');await expect(names(page)).toHaveText(['Bolt, hex 1/4-20']);
 await page.locator('.inventory-results .location-link').click();
 await page.getByLabel('Search location inventory').fill('hex bolt 1/4-20');
 await expect(names(page)).toHaveText(['Bolt, hex 1/4-20']);
 await page.reload();await expect(page.getByLabel('Search location inventory')).toHaveValue('hex bolt 1/4-20');
 await expect(names(page)).toHaveText(['Bolt, hex 1/4-20']);
 expect(await savedData(page)).toBe(before);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [390,1440]) test(`filtered empty state clears collapsed filters and stays cleared on reload at ${width}px`, async({page},testInfo) => {
 await page.setViewportSize({width,height:844});await seed(page);await page.goto('/#inventory');
 const before=await savedData(page);
 await page.getByLabel('Search inventory').fill('hex bolt');await openFilters(page);
 await page.getByLabel('Filter by item type',{exact:true}).selectOption('Tool');
 await page.locator('details.inventory-filters summary').click();
 await expect(page.getByRole('heading',{name:'No matching items',exact:true})).toBeVisible();
 await expect(page.getByText(/Your search or filters did not match/)).toBeVisible();
 await page.screenshot({path:testInfo.outputPath(`search-empty-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'Clear search and filters',exact:true}).click();
 await expect(names(page)).toHaveCount(6);await expect(page.getByLabel('Search inventory')).toHaveValue('');
 await expect(page.getByLabel('Filter by item type',{exact:true})).toHaveValue('');
 await page.reload();await expect(names(page)).toHaveCount(6);
 await page.locator('.inventory-results .location-link').first().click();
 await page.getByLabel('Search location inventory').fill('not a real item');
 await expect(page.getByRole('heading',{name:'No matching items in this location',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Clear search and filters',exact:true}).click();
 await expect(names(page)).toHaveCount(6);
 expect(await savedData(page)).toBe(before);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('an actually empty workspace offers a permitted draft action without saving records',async({page})=>{
 const db=fixture();db.items=[];await seed(page,db);await page.goto('/#inventory');
 const before=await savedData(page);
 await expect(page.getByRole('heading',{name:'No inventory items available',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add first item',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Add an item'})).toBeVisible();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await savedData(page)).toBe(before);
});
