import {test,expect,type Page} from '@playwright/test';
async function login(page:Page,role:string){
 const response=await page.request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password',{data:{email:role+'@example.test',password:'test-password'}});
 const session=await response.json();await page.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),session);await page.goto('/#locations');
 return session;
}
for(const [role,width] of [['leadUnassigned',390],['adminLeadUnassigned',1440],['adminLead',390]] as const)test(`${role} creates storage anywhere at ${width}px without suite administration or storage settings`,async({page})=>{
 await page.setViewportSize({width,height:900});await login(page,role);
 await expect(page.getByRole('button',{name:'Admin',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Add location',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Storage use',exact:true})).toHaveValue('permanent');
 await expect(page.getByRole('combobox',{name:'Storage use',exact:true}).locator('option')).toHaveCount(5);
 await expect(page.getByRole('combobox',{name:'Owner team area',exact:true}).locator('option')).toHaveCount(11);
 await expect(page.getByRole('combobox',{name:'Parent location',exact:true}).locator('option[value="44180000-0000-4000-8000-000000000099"]')).toHaveCount(0);
 const name=`Synthetic ${role} storage ${width}`;
 await page.getByLabel('Location name',{exact:true}).fill(name);await page.getByRole('combobox',{name:'Location type',exact:true}).selectOption(role==='leadUnassigned'?'Box':role==='adminLeadUnassigned'?'Toolbox':'Closet');
 await page.getByRole('combobox',{name:'Owner team area',exact:true}).selectOption('44180000-0000-4000-8000-000000000002');
 await page.getByLabel('Area / Room',{exact:true}).fill('Robotics Lab');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:`test-results/assigned-lead-create-${role}-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Create location',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 await expect(page.getByLabel('Upload location photo')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Edit storage settings',exact:true})).toHaveCount(0);
 if(role==='leadUnassigned'){await expect(page.getByRole('button',{name:'Rename location',exact:true})).toHaveCount(0);}else{
 await page.getByRole('button',{name:'Rename location',exact:true}).click();
 await page.getByLabel('New location name',{exact:true}).fill(name+' renamed');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`test-results/assigned-lead-rename-${role}-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Save name',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:name+' renamed',exact:true})).toBeVisible();}
 await page.goto('/#admin');await expect(page.getByRole('heading',{name:'Inventory data',exact:true})).toHaveCount(0);
});
for(const role of ['student','assigned','programManager','projectManager','readonly','pendingLead'])test(`${role} has no location creation grant`,async({page})=>{
 await login(page,role);await expect(page.getByRole('heading',{name:'A place for every part.',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Add location',exact:true})).toHaveCount(0);
});
test('a Lead role downgrade closes the location form and cannot send a write',async({page})=>{
 await login(page,'leadUnassigned');await page.getByRole('button',{name:'Add location',exact:true}).click();
 await page.getByLabel('Location name',{exact:true}).fill('Do not create after role removal');
 let writes=0;page.on('request',request=>{if(request.url().endsWith('/rpc/inventory_action'))writes++;});
 await page.route('**/rest/v1/profiles?*',async route=>{const response=await route.fetch();const rows=await response.json();await route.fulfill({response,json:rows.map((row:{id:string;role:string})=>row.id==='00000000-0000-4000-8000-000000000010'?{...row,role:'student'}:row)});});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Add location',exact:true})).toHaveCount(0);expect(writes).toBe(0);
 await page.unroute('**/rest/v1/profiles?*');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('button',{name:'Add location',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes).toBe(0);
});
test('cancel, close, navigation and repeated submit do not create duplicates',async({page})=>{
 await login(page,'leadUnassigned');const open=()=>page.getByRole('button',{name:'Add location',exact:true}).click();
 let writes=0;page.on('request',request=>{if(request.url().endsWith('/rpc/inventory_action'))writes++;});
 await open();await page.getByLabel('Location name',{exact:true}).fill('Discard this');await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await open();await expect(page.getByLabel('Location name',{exact:true})).toHaveValue('');await page.getByRole('button',{name:'Close add location',exact:true}).click();
 await open();await page.getByLabel('Location name',{exact:true}).fill('Discard navigation');await page.goto('/#inventory');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes).toBe(0);
 await open();await page.getByLabel('Location name',{exact:true}).fill('Synthetic single submit');
 await page.route('**/rest/v1/rpc/inventory_action',async route=>{await new Promise(resolve=>setTimeout(resolve,200));await route.continue();});
 await page.locator('form').filter({has:page.getByLabel('Location name',{exact:true})}).evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes).toBe(1);
});

for(const width of [390,1440])for(const role of ['leadUnassigned','leadStorage','leadInactiveArea'])test(`${role} creates normal storage without an assigned active area at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await login(page,role);
 await expect(page.getByRole('heading',{name:'A place for every part.',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Add item',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Add location',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Add location',exact:true});
 await expect(form.getByRole('combobox',{name:'Storage use',exact:true}).locator('option')).toHaveCount(5);
 await expect(form.getByRole('combobox',{name:'Owner team area',exact:true}).locator('option')).toHaveCount(11);
 await form.getByRole('combobox',{name:'Owner team area',exact:true}).selectOption('44180000-0000-4000-8000-000000000002');
 await form.getByLabel('Location name',{exact:true}).fill(`Synthetic ${role} all-area storage ${width}`);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 if(role==='leadUnassigned')await page.screenshot({path:`test-results/location-unassigned-lead-${width}.png`,fullPage:true,animations:'disabled'});
 await form.getByRole('button',{name:'Create location',exact:true}).click();await expect(form).toHaveCount(0);
});
test('account Lead with a primary area can create storage in another area without gaining rename',async({page})=>{
 await login(page,'lead');await page.getByRole('button',{name:'Add location',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Add location',exact:true});
 await expect(form.getByRole('combobox',{name:'Storage use',exact:true}).locator('option')).toHaveCount(5);
 await expect(form.getByRole('combobox',{name:'Owner team area',exact:true}).locator('option')).toHaveCount(11);
 await form.getByRole('combobox',{name:'Owner team area',exact:true}).selectOption('44180000-0000-4000-8000-000000000002');
 await expect(form.getByRole('combobox',{name:'Parent location',exact:true})).toBeVisible();
 await form.getByLabel('Location name',{exact:true}).fill('Synthetic cross-area Lead storage');
 await form.getByRole('button',{name:'Create location',exact:true}).click();await expect(form).toHaveCount(0);
 await page.getByRole('button',{name:/Synthetic cross-area Lead storage/}).click();await expect(page.getByRole('button',{name:'Rename location',exact:true})).toHaveCount(0);await expect(page.getByLabel('Upload location photo')).toHaveCount(0);
});
test('losing active status closes a location form without submitting it',async({page})=>{
 await login(page,'lead');await page.getByRole('button',{name:'Add location',exact:true}).click();
 await page.getByLabel('Location name',{exact:true}).fill('Do not submit after account deactivation');
 let writes=0;page.on('request',request=>{if(request.url().endsWith('/rpc/inventory_action'))writes++;});
 await page.route('**/rest/v1/profiles?*',async route=>{
  const response=await route.fetch();const rows=await response.json();
  await route.fulfill({response,json:rows.map((row:{id:string;active:boolean})=>row.id==='00000000-0000-4000-8000-000000000003'?{...row,active:false}:row)});
 });
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Add location',exact:true})).toHaveCount(0);expect(writes).toBe(0);
});
