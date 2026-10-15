import { test, expect } from '@playwright/test';
import { demo } from '../src/data';
const key = 'frc-4418-inventory-v1';

test.beforeEach(async ({page}) => {
  const data = demo();
  data.areas.unshift({id:'legacy-closet',name:'Closet',lead:''});
  data.areas.reverse();
  data.items[0].areaId='legacy-closet';
  await page.addInitScript(({key,data})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(data));},{key,data});
});
const saved = (page: import('@playwright/test').Page) => page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);

test('icons follow named areas when reordered; Closet items remain discoverable separately', async ({page}) => {
  await page.goto('/');
  for(const [name,icon] of [['Fabrication','wrench'],['Power','zap'],['Software','code-xml'],['Operations','clipboard-list'],['CAD','pen-tool'],['Strategy','target'],['Finance','wallet'],['Business','briefcase-business'],['Communications','megaphone'],['General / Admin','settings']]){
    const card=page.locator('.area-card').filter({has:page.getByRole('heading',{name,exact:true})});
    await expect(card.locator(`svg.lucide-${icon}`)).toHaveCount(1);
  }
  await expect(page.locator('.area-card')).toHaveCount(10);
  await expect(page.locator('.area-assignment')).toContainText('Needs team area');
  await page.getByRole('button',{name:'Review Closet items'}).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Kraken X60');
  await expect(page.locator('tbody')).toContainText('Needs team area (Closet)');
});

test('team area changes independently, persists, updates filters, and preserves locations and counts', async ({page}) => {
  await page.goto('/#inventory');
  const before=await saved(page);
  await page.getByRole('button',{name:'Kraken X60',exact:true}).click();
  await expect(page.getByLabel('Team area *')).toHaveValue('legacy-closet');
  await page.getByLabel('Team area *').selectOption('fabrication');
  await expect(page.getByLabel('Location / Bin')).toHaveValue('e-04');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after=await saved(page);
  expect(after.locations).toEqual(before.locations);
  expect(after.areas).toEqual(before.areas);
  expect(after.items[0]).toEqual({...before.items[0],areaId:'fabrication',updatedAt:after.items[0].updatedAt});
  await page.reload();
  await page.getByLabel('Filter by area').selectOption('fabrication');
  await expect(page.getByRole('button',{name:'Kraken X60',exact:true})).toBeVisible();
  await page.getByLabel('Filter by area').selectOption('legacy-closet');
  await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('cancel, Escape, and unrelated saves never reassign legacy Closet items',async({page})=>{
  await page.goto('/#inventory');
  for(const dismiss of ['Cancel','Escape']){
    await page.getByRole('button',{name:'Kraken X60',exact:true}).click();
    await page.getByLabel('Team area *').selectOption('software');
    if(dismiss==='Escape')await page.keyboard.press('Escape');
    else await page.getByRole('button',{name:'Cancel',exact:true}).click();
    expect((await saved(page)).items[0].areaId).toBe('legacy-closet');
  }
  await page.getByRole('button',{name:'Kraken X60',exact:true}).click();
  await page.getByLabel('Notes',{exact:true}).fill('Still deciding the team area');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await saved(page)).items[0].areaId).toBe('legacy-closet');
  expect((await saved(page)).items[0].locationId).toBe('e-04');
});

test('new items do not inherit Closet from storage and mobile controls fit',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#location/e-04');
  await page.getByRole('button',{name:'Add item',exact:true}).click();
  await expect(page.getByLabel('Team area *').locator('option[value="legacy-closet"]')).toHaveCount(0);
  await expect(page.getByLabel('Location / Bin')).toHaveValue('e-04');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
