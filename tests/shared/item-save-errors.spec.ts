import {test,expect,type Page} from '@playwright/test';

// Intercept only writes to the synthetic fixture. Reads continue to work.
async function login(page:Page,role:string){
 const response=await page.request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password',{data:{email:`${role}@example.test`,password:'test-password'}});
 const session=await response.json();await page.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),session);await page.goto('/#inventory');
 await expect(page.getByRole('heading',{name:'Inventory',exact:true})).toBeVisible();
}
// Each edit/count case owns an isolated local-fixture item. Never mutate the
// shared baseline wrench relied on by the existing realtime and audit tests.
async function createEditorFixture(page:Page,name:string){
 const auth=await page.request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password',{data:{email:'mentor@example.test',password:'test-password'}});
 const session=await auth.json(),headers={Authorization:`Bearer ${session.access_token}`};
 const read=await page.request.get('http://127.0.0.1:54329/rest/v1/inventory_items?id=eq.20000000-0000-4000-8000-000000000001',{headers});expect(read.ok()).toBe(true);
 const [template]=await read.json();expect(template).toBeTruthy();
 const record={...template,id:crypto.randomUUID(),name,quantity:4,location_id:null,notes:''};
 const created=await page.request.post('http://127.0.0.1:54329/rest/v1/rpc/apply_inventory_changes',{headers,data:{p_changes:{items:[{record,expected_updated_at:null}]}}});expect(created.ok(),await created.text()).toBe(true);
}
for(const width of [390,1440])for(const action of ['Add item','Save changes','Student changes'] as const)test(`${action} failure is in the dialog, retains the draft, and retries without duplicate writes at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const button=action==='Add item'?'Add item':'Save changes';
 const name=`Synthetic retry ${action} ${width}`,tool=`Synthetic recovery tool ${action} ${width}`;
 if(action!=='Add item')await createEditorFixture(page,tool);
 await login(page,action==='Save changes'?'mentor':'student');
 if(action==='Add item')await page.getByRole('button',{name:'Add item',exact:true}).click();
 else{await page.getByLabel('Search inventory').fill(tool);await page.getByRole('button',{name:tool,exact:true}).click();}
 const dialog=page.getByRole('dialog');
 if(action==='Add item')await dialog.getByLabel('Item name *',{exact:true}).fill(name);
 if(action==='Save changes'){await dialog.locator('summary').filter({hasText:/More details/}).click();await dialog.getByLabel('Notes',{exact:true}).fill(name);}
 const count=dialog.getByLabel(action==='Add item'?'Quantity *':'Current quantity *',{exact:true});const quantity=String(Number(await count.inputValue())+1);await count.fill(quantity);
 let reject=true,writes=0;
 await page.route('**/rest/v1/rpc/**',async route=>{
  if(route.request().method()!=='POST'||!['apply_inventory_changes','change_inventory_quantity'].some(name=>route.request().url().endsWith('/rpc/'+name))){await route.continue();return;}
  writes++;
  if(reject)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic item write unavailable'})});
  else{await new Promise(resolve=>setTimeout(resolve,150));await route.continue();}
 });
 await dialog.getByRole('button',{name:button,exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Synthetic item write unavailable');await expect(dialog.getByRole('alert')).toBeFocused();
 await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport({ratio:1});await expect(dialog.getByRole('button',{name:button,exact:true})).toBeInViewport({ratio:1});
 await expect(count).toHaveValue(quantity);if(action==='Add item')await expect(dialog.getByLabel('Item name *',{exact:true})).toHaveValue(name);
 if(action==='Save changes')await expect(dialog.getByLabel('Notes',{exact:true})).toHaveValue(name);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:`test-results/item-save-error-${action.toLowerCase().replaceAll(' ','-')}-${width}.png`,fullPage:true,animations:'disabled'});
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Keep editing',exact:true}).click();
 await expect(count).toHaveValue(quantity);
 await dialog.getByRole('button',{name:button,exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Synthetic item write unavailable');await expect(dialog.getByRole('alert')).toBeFocused();
 await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport({ratio:1});await expect(dialog.getByRole('button',{name:button,exact:true})).toBeInViewport({ratio:1});
 reject=false;
 await dialog.locator('form').evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});
 await expect(dialog).toHaveCount(0);expect(writes).toBe(3);await expect(page.getByRole('alert')).toHaveCount(0);
 await page.getByLabel('Search inventory').fill(action==='Add item'?name:tool);await page.getByRole('button',{name:action==='Add item'?name:tool,exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
 if(action==='Save changes'){await dialog.locator('summary').filter({hasText:/More details/}).click();await expect(dialog.getByLabel('Notes',{exact:true})).toHaveValue(name);}
 await expect(page.getByRole('dialog').getByLabel(action==='Add item'?'Quantity *':'Current quantity *',{exact:true})).toHaveValue(quantity);
});
test('discarding a failed new item clears its error before another form opens',async({page})=>{
 await login(page,'student');await page.getByRole('button',{name:'Add item',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Item name *',{exact:true}).fill('Synthetic discarded failure');
 await page.route('**/rest/v1/rpc/apply_inventory_changes',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic item write unavailable'})}));
 await dialog.getByRole('button',{name:'Add item',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Discard changes',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveCount(0);await page.getByRole('button',{name:'Add item',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);await expect(page.getByLabel('Item name *',{exact:true})).toHaveValue('');
});

test('successful Student edit with a failed refresh keeps the do-not-submit-again message after dismissal',async({page})=>{
 const tool='Synthetic confirmed-save refresh tool';await createEditorFixture(page,tool);await login(page,'student');await page.getByLabel('Search inventory').fill(tool);await page.getByRole('button',{name:tool,exact:true}).click();
 const dialog=page.getByRole('dialog'),count=dialog.getByLabel('Current quantity *',{exact:true});await count.fill(String(Number(await count.inputValue())+1));
 let saved=false,writes=0;
 await page.route('**/rest/v1/rpc/apply_inventory_changes',async route=>{writes++;const response=await route.fetch();saved=response.ok();await route.fulfill({response});});
 await page.route('**/rest/v1/inventory_items?*',async route=>{if(saved)await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Synthetic nonretryable read failure after save'})});else await route.continue();});
 await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('alert').filter({hasText:'Your change was saved'})).toContainText('do not submit the change again');expect(writes).toBe(1);
});
