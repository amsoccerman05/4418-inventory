import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const api='http://127.0.0.1:54329',home='10000000-0000-4000-8000-000000000001',area='44180000-0000-4000-8000-000000000001',other='44180000-0000-4000-8000-000000000002';
test.use({serviceWorkers:'block'});
// Observed app stylesheet; fulfilled locally as empty CSS. Screenshots use
// fallback fonts, never external font traffic. Every other external URL fails.
const fontCSS='https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;450;500;550;600;650;700&family=Manrope:wght@400;500;600;650;700;750;800&display=swap';
const unexpected=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{
 const rejected:string[]=[];unexpected.set(page,rejected);
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.href===fontCSS){await route.fulfill({contentType:'text/css',body:'/* synthetic offline font fallback */'});return;}if(['http://127.0.0.1:5176',api].includes(u.origin))await route.continue();else{rejected.push(u.href);await route.abort('blockedbyclient');}});
 await page.routeWebSocket('**/*',ws=>{const u=new URL(ws.url());if(['ws://127.0.0.1:5176','ws://127.0.0.1:54329'].includes(u.origin))ws.connectToServer();else{rejected.push(u.href);ws.close();}});
});
test.afterEach(async({page})=>{expect(unexpected.get(page),'No external HTTP or WebSocket traffic is allowed').toEqual([]);});
async function session(request:APIRequestContext,who:string){const r=await request.post(api+'/auth/v1/token?grant_type=password',{data:{email:who+'@example.test',password:'test-password'}});expect(r.ok()).toBe(true);return r.json();}
const headers=(s:any)=>({Authorization:`Bearer ${s.access_token}`});
async function rows(page:Page,s:any,table:string){const r=await page.request.get(api+'/rest/v1/'+table,{headers:headers(s)});expect(r.ok(),await r.text()).toBe(true);return r.json();}
async function action(page:Page,s:any,name:string,data:object){const r=await page.request.post(api+'/rest/v1/rpc/inventory_action',{headers:headers(s),data:{p_action:name,p_data:data}});expect(r.ok(),await r.text()).toBe(true);return r.json();}
async function login(page:Page,who:string,role:string,hash='inventory'){
 const s=await session(page.request,who);const p=(await rows(page,s,'profiles')).find((p:any)=>p.id===s.user.id);expect(p.role).toBe(role);
 if(who==='student')expect(p.primary_area_id).toBeNull();
 await page.addInitScript(s=>localStorage.setItem('sb-127-auth-token',JSON.stringify(s)),s);await page.goto('/#'+hash);return s;
}
async function fixtureItem(page:Page,name:string,target=area){
 const s=await session(page.request,'mentor');const [template]=(await rows(page,s,'inventory_items')).filter((i:any)=>i.id==='20000000-0000-4000-8000-000000000001');
 const record={...template,id:crypto.randomUUID(),name,area_id:target,quantity:6,notes:''};
 const r=await page.request.post(api+'/rest/v1/rpc/apply_inventory_changes',{headers:headers(s),data:{p_changes:{items:[{record,expected_updated_at:null}]}}});expect(r.ok(),await r.text()).toBe(true);return record;
}
async function capture(page:Page,name:string,width:number){expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`test-results/current-role-${name}-${width}.png`,fullPage:true,animations:'disabled'});}
for(const width of [390,1440]){
 test(`genuine Student without area or position adds, counts, verifies and moves normal stock at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const s=await login(page,'student','student','location/'+home),name=`Synthetic Student everyday ${width}`;
  await expect(page.getByRole('heading',{name:'TA-01',exact:true})).toBeVisible();await page.getByRole('button',{name:'Add item',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Item name *',{exact:true}).fill(name);await dialog.getByLabel('Total tracked quantity *',{exact:true}).fill('6');await dialog.getByRole('button',{name:'Add item',exact:true}).click();await expect(dialog).toHaveCount(0);
  const item=(await rows(page,s,'inventory_items')).find((i:any)=>i.name===name);expect(item).toBeTruthy();expect(item.created_by).toBe(s.user.id);
  await page.goto('/#inventory');await page.getByLabel('Search inventory').fill(name);await page.getByRole('button',{name,exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Delete item',exact:true})).toHaveCount(0);await expect(dialog.getByLabel('Upload item photo')).toHaveCount(0);
  await dialog.getByLabel('Count at '+home,{exact:true}).fill('7');await dialog.getByRole('button',{name:'Save count',exact:true}).click();
  await expect.poll(async()=>Number((await rows(page,s,'inventory_balances')).find((b:any)=>b.inventory_item_id===item.id&&b.location_id===home).quantity)).toBe(7);
  await dialog.getByRole('button',{name:'Verify quantity',exact:true}).click();await expect.poll(async()=>(await rows(page,s,'inventory_balances')).find((b:any)=>b.inventory_item_id===item.id&&b.location_id===home).last_verified_by).toBe(s.user.id);
  await capture(page,'student-stock',width);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  const mentor=await session(page.request,'mentor'),destination=await action(page,mentor,'create_location',{name:`Synthetic Student destination ${width}`,classification:'permanent'});
  await page.reload();await page.getByRole('button',{name:'Move '+name,exact:true}).click();await page.getByLabel('To location',{exact:true}).selectOption(destination.id);await page.getByRole('button',{name:'Move inventory',exact:true}).click();await expect(dialog).toHaveCount(0);
  const moves=await rows(page,s,'inventory_movements');expect(moves.some((m:any)=>m.inventory_item_id===item.id&&m.user_id===s.user.id)).toBe(true);
  await expect(page.getByRole('button',{name:'Admin',exact:true})).toHaveCount(0);
 });
 test(`genuine Student packs, moves and returns already approved stock at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const item=await fixtureItem(page,`Synthetic Student travel ${width}`),mentor=await session(page.request,'mentor');
  const trip=await action(page,mentor,'create_trip',{name:`Synthetic Student journey ${width}`});await action(page,mentor,'trip_status',{tripId:trip.id,status:'packing'});const locations=await rows(page,mentor,'locations'),trailer=locations.find((l:any)=>l.trip_id===trip.id&&l.name==='Trailer'),pit=locations.find((l:any)=>l.trip_id===trip.id&&l.name==='Pit Toolbox A');
  await action(page,mentor,'approve',{tripId:trip.id,itemId:item.id,from:home,to:trailer.id,quantity:2});const s=await login(page,'student','student','trip/'+trip.id);
  await expect(page.getByRole('button',{name:'Approve for packing',exact:true})).toHaveCount(0);await expect(page.getByLabel('Trip status',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Pack',exact:true}).click();await page.getByRole('button',{name:'Confirm pack',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Move within trip',exact:true}).click();await page.getByRole('combobox',{name:'Allocation destination',exact:true}).selectOption(pit.id);await page.getByRole('button',{name:'Confirm internal',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await capture(page,'student-approved-travel',width);await expect(page.getByRole('button',{name:'Resolve',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Return home',exact:true}).click();await page.getByRole('button',{name:'Confirm return',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(Number((await rows(page,s,'inventory_balances')).find((b:any)=>b.inventory_item_id===item.id&&b.location_id===home).quantity)).toBe(6);
 });
 test(`Admin Lead own-area editor preserves failed draft; cross-area stays stock-only at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const own=await fixtureItem(page,`Synthetic Admin Lead own ${width}`),cross=await fixtureItem(page,`Synthetic Admin Lead cross ${width}`,other);await login(page,'adminLead','admin_lead');
  await page.getByLabel('Search inventory').fill(own.name);await page.getByRole('button',{name:own.name,exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'Delete item',exact:true})).toBeEnabled();await expect(dialog.getByLabel('Upload item photo')).toHaveCount(1);
  await dialog.getByLabel('Item name *',{exact:true}).fill(own.name+' draft');await page.route('**/rpc/apply_inventory_changes',route=>route.fulfill({status:503,json:{message:'Synthetic denied write; retry is safe'}}));await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Synthetic denied write');await expect(dialog.getByLabel('Item name *',{exact:true})).toHaveValue(own.name+' draft');await capture(page,'admin-lead-failed-save',width);
  await page.unroute('**/rpc/apply_inventory_changes');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.locator('.inventory-filters summary').click();await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.getByLabel('Search inventory').fill(cross.name);await page.getByRole('button',{name:cross.name,exact:true}).click();await expect(dialog.getByLabel('Item name *',{exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'Delete item',exact:true})).toHaveCount(0);await expect(dialog.getByLabel('Upload item photo')).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Save count',exact:true})).toBeEnabled();await capture(page,'admin-lead-cross-area',width);
 });
 test(`unassigned Admin Lead gets guidance and everyday item access at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await login(page,'adminLeadUnassigned','admin_lead','locations');await expect(page.getByRole('button',{name:'Add location',exact:true})).toHaveCount(0);await expect(page.getByText('To add a project location, ask a mentor to assign you an active team area.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Add item',exact:true})).toBeEnabled();await capture(page,'admin-lead-unassigned',width);
 });
 test(`assigned Admin Lead creates and name-only renames normal storage at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await login(page,'adminLeadAssigned','admin_lead','locations');const name=`Synthetic Admin Lead storage ${width}`;await page.getByRole('button',{name:'Add location',exact:true}).click();await page.getByLabel('Location name',{exact:true}).fill(name);await page.getByRole('combobox',{name:'Owner team area',exact:true}).selectOption(other);await page.getByRole('button',{name:'Create location',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page.getByRole('button',{name:'Edit storage settings',exact:true})).toHaveCount(0);await expect(page.getByLabel('Upload location photo')).toHaveCount(0);await page.getByRole('button',{name:'Rename location',exact:true}).click();await page.getByLabel('New location name',{exact:true}).fill(name+' renamed');await capture(page,'admin-lead-assigned-location',width);await page.getByRole('button',{name:'Save name',exact:true}).click();await expect(page.getByRole('heading',{name:name+' renamed',exact:true})).toBeVisible();
 });
 test(`Readonly retains position but no business write controls at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await login(page,'readonly','readonly','locations');await expect(page.getByRole('button',{name:'Add location',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Add item',exact:true})).toHaveCount(0);await page.goto('/#inventory');await page.getByRole('button',{name:'5/32" Allen wrench',exact:true}).click();const d=page.getByRole('dialog');await expect(d.getByRole('button',{name:/Save|Delete item|Verify quantity/,exact:false})).toHaveCount(0);await expect(d.getByLabel('Upload item photo')).toHaveCount(0);await capture(page,'readonly',width);
 });
}
test('inactive Admin Lead with retained area and position cannot enter Inventory',async({page})=>{await login(page,'adminLeadInactive','admin_lead');await expect(page.getByText(/account.*inactive|inactive.*account/i)).toBeVisible();await expect(page.getByRole('button',{name:'Add item',exact:true})).toHaveCount(0);});
