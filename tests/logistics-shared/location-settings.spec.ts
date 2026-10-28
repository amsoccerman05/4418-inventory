import {test,expect,type Page} from '@playwright/test';
const api='http://127.0.0.1:54329';
async function login(page:Page,role:string){
 const response=await page.request.post(api+'/auth/v1/token?grant_type=password',{data:{email:role+'@example.test',password:'test-password'}});
 const session=await response.json();await page.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),session);
 return {Authorization:'Bearer '+session.access_token};
}
for(const [role,width] of [['admin',390],['mentor',1440]] as const)test(`${role} changes existing project storage type and use at ${width}px without recreating it`,async({page})=>{
 await page.setViewportSize({width,height:900});const headers=await login(page,role);
 const rpc=async(p_action:string,p_data:object)=>{const r=await page.request.post(api+'/rest/v1/rpc/inventory_action',{headers,data:{p_action,p_data}});expect(r.ok()).toBe(true);return r.json();};
 const {id}=await rpc('create_location',{name:`Synthetic ${role} project container`,kind:'Storage',classification:'project'});
 const {id:child}=await rpc('create_location',{name:`Synthetic ${role} child box`,kind:'Box',parentId:id,classification:'permanent'});
 const before=(await (await page.request.get(api+'/rest/v1/locations?id=eq.'+id,{headers})).json())[0];
 await page.goto('/#location/'+id);await page.getByRole('button',{name:'Edit storage settings',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Location type',exact:true})).toBeFocused();
 await expect(page.getByRole('combobox',{name:'Storage use',exact:true})).toHaveValue('project');
 await page.getByRole('combobox',{name:'Location type',exact:true}).selectOption(role==='admin'?'Toolbox':'Closet');
 await page.getByRole('combobox',{name:'Storage use',exact:true}).selectOption('permanent');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:`test-results/location-settings-${role}-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Save storage settings',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page).toHaveURL(new RegExp('#location/'+id+'$'));
 const after=(await (await page.request.get(api+'/rest/v1/locations?id=eq.'+id,{headers})).json())[0];
 expect(after.location_type).toBe(role==='admin'?'Toolbox':'Closet');expect(after.classification).toBe('permanent');
 const omit=({location_type,classification,updated_at,...rest}:Record<string,unknown>)=>rest;expect(omit(after)).toEqual(omit(before));
 const childRow=(await (await page.request.get(api+'/rest/v1/locations?id=eq.'+child,{headers})).json())[0];expect(childRow.parent_id).toBe(id);
 await page.getByRole('button',{name:'Edit storage settings',exact:true}).click();await page.getByRole('combobox',{name:'Location type',exact:true}).selectOption('Drawer');
 await page.getByRole('button',{name:'Save storage settings',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('not saved');
});
test('stale rename preserves the concurrent name and can recover after reopen',async({page})=>{
 const headers=await login(page,'assigned');
 const create=await page.request.post(api+'/rest/v1/rpc/inventory_action',{headers,data:{p_action:'create_location',p_data:{name:'Synthetic rename conflict',kind:'Box',classification:'permanent'}}});expect(create.ok()).toBe(true);const {id}=await create.json();
 await page.goto('/#location/'+id);await page.getByRole('button',{name:'Rename location',exact:true}).click();await page.getByLabel('New location name',{exact:true}).fill('Stale draft name');
 const row=(await (await page.request.get(api+'/rest/v1/locations?id=eq.'+id,{headers})).json())[0];
 const other=await page.request.post(api+'/rest/v1/rpc/inventory_action',{headers,data:{p_action:'rename_location',p_data:{id,name:'Concurrent location name',updatedAt:row.updated_at}}});expect(other.ok()).toBe(true);
 await page.getByRole('button',{name:'Save name',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('not renamed');await expect(page.getByLabel('New location name',{exact:true})).toHaveValue('Stale draft name');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('heading',{name:'Concurrent location name',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Rename location',exact:true}).click();await expect(page.getByLabel('New location name',{exact:true})).toHaveValue('Concurrent location name');await page.getByLabel('New location name',{exact:true}).fill('Recovered location name');
 await page.screenshot({path:'test-results/location-rename-recovery.png',fullPage:true});
 await page.getByRole('button',{name:'Save name',exact:true}).click();await expect(page.getByRole('heading',{name:'Recovered location name',exact:true})).toBeVisible();await expect(page).toHaveURL(new RegExp('#location/'+id+'$'));
 await page.getByRole('button',{name:'Rename location',exact:true}).click();
 await page.route('**/rest/v1/rpc/inventory_location_creation_context',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user_id:'00000000-0000-4000-8000-000000000006',assigned_lead:false})}));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Rename location',exact:true})).toHaveCount(0);
});
for(const role of ['student','readonly','lead'])test(`${role} does not gain rename or storage settings`,async({page})=>{
 await login(page,role);await page.goto('/#location/10000000-0000-4000-8000-000000000001');await expect(page.getByRole('heading',{name:'TA-01',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Rename location',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit storage settings',exact:true})).toHaveCount(0);
});
