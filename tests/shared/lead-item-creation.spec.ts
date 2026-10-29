import {test,expect,type Page} from '@playwright/test';
const drawer='10000000-0000-4000-8000-000000000001';
async function login(page:Page,role:string){const response=await page.request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password',{data:{email:role+'@example.test',password:'test-password'}});const session=await response.json();await page.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),session);await page.goto('/#inventory');}
for(const role of ['leadUnassigned','leadStorage','leadInactiveArea'])test(`${role} can create an item with a valid area with everyday editing but without cross-area deletion`,async({page})=>{
 await page.setViewportSize({width:390,height:900});await login(page,role);
 await page.getByRole('button',{name:'Add item',exact:true}).click();
 const area=page.getByLabel('Team area *');
 expect(await area.inputValue()).not.toBe('');expect(await area.inputValue()).not.toBe('44180000-0000-4000-8000-000000000098');expect(await area.inputValue()).not.toBe('44180000-0000-4000-8000-000000000097');
 await expect(area.locator('option[value="44180000-0000-4000-8000-000000000098"]')).toHaveCount(0);await expect(area.locator('option[value="44180000-0000-4000-8000-000000000097"]')).toHaveCount(0);
 const name=`Synthetic ${role} part`;await page.getByLabel('Item name *').fill(name);await area.selectOption({label:'Software'});await page.getByLabel('Location / Bin').selectOption(drawer);
 await page.getByRole('dialog').getByRole('button',{name:'Add item',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.goto('/#location/'+drawer);await page.getByRole('button',{name,exact:true}).click();
 await expect(page.getByLabel('Item name *')).toBeEnabled();await expect(page.getByLabel('Team area *')).toBeDisabled();
 await expect(page.getByRole('button',{name:'Delete item',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Save changes',exact:true})).toBeVisible();await expect(page.getByLabel('Upload item photo')).toHaveCount(0);
});
