import { test,expect,type Page } from '@playwright/test';
// Exercise the SDK and shared repository with the HTTP-limited Crypto API.
test.beforeEach(async({page})=>{await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true}));});
const drawer='10000000-0000-4000-8000-000000000001';
const tool='5/32" Allen wrench';
async function signIn(page:Page,role:string){const response=await page.request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password',{data:{email:role+'@example.test',password:'test-password'}});const session=await response.json();await page.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),session);await page.goto('/');if(role!=='inactive')await expect(page.getByRole('button',{name:'Inventory',exact:true})).toBeVisible();}

test('direct login, restoration, protected routes and logout',async({page})=>{
 await page.goto('/#inventory');await expect(page.getByRole('heading',{name:'Inventory sign in'})).toBeVisible();await page.getByLabel('Team account email').fill('student@example.test');await page.getByLabel('Password',{exact:true}).fill('test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/#inventory$/);await page.goto('/#inventory');await expect(page.getByRole('heading',{name:'Inventory',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Inventory',exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Inventory sign in'})).toBeVisible();await expect(page).toHaveURL(/\/#inventory$/);
});

test('student phone change is attributed and reaches a second device via realtime',async({page,browser})=>{
 await page.setViewportSize({width:390,height:844});
 const context=await browser.newContext();const mentor=await context.newPage();
 try{
  await signIn(mentor,'mentor');await mentor.goto(`/#location/${drawer}`);
  await signIn(page,'student');await page.getByRole('button',{name:'Toggle navigation'}).click();await page.getByRole('button',{name:'Inventory',exact:true}).click();
  await page.getByLabel('Search inventory').fill('5/32 Allen Wrench');await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button',{name:`Remove one ${tool}`,exact:true}).click();await expect(page.locator('.quantity-toast')).toContainText('3 each');
  await expect(mentor.getByLabel(`Current quantity for ${tool}`)).toHaveValue('3',{timeout:10000});
  await expect(mentor.locator('.audit-row').filter({has:mentor.getByRole('button',{name:tool,exact:true})})).toContainText('Missing tools');
  await mentor.getByRole('button',{name:tool,exact:true}).click();await expect(mentor.getByText('Updated by Student',{exact:true})).toBeVisible();
  await expect(mentor.locator('.activity')).toContainText('4 → 3');await expect(mentor.locator('.activity')).toContainText('Student');
  await page.getByRole('button',{name:tool,exact:true}).click();await expect(page.getByLabel('Item name *')).toBeDisabled();await expect(page.getByLabel('Team area *')).toBeDisabled();await expect(page.getByLabel('Target quantity (overall)',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Verify quantity',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).toContainText('verified and saved');
  await mentor.getByRole('button',{name:'Verify quantity',exact:true}).click();await expect(mentor.getByRole('dialog').getByRole('status')).toContainText('Could not verify quantity');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 }finally{await context.close();}
});

test('readonly sees all inventory but cannot edit or audit; admin route is protected',async({page})=>{
 await signIn(page,'readonly');await page.goto('/#inventory');await expect(page.getByRole('button',{name:`Remove one ${tool}`,exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Add item',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:tool,exact:true}).click();await expect(page.getByLabel('Current quantity *',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Verify quantity',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.goto(`/#location/${drawer}`);await expect(page.getByRole('button',{name:'Drawer audit',exact:true})).toHaveCount(0);
 await page.goto('/#admin');await expect(page.getByText('Admin access is restricted to admins and mentors.')).toBeVisible();await expect(page.getByRole('heading',{name:'Inventory data'})).toHaveCount(0);
});

test('lead starts in assigned area and only edits its metadata',async({page})=>{
 await signIn(page,'lead');await expect(page.getByText('Fabrication Lead',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Inventory',exact:true}).click();await expect(page.getByLabel('Filter by area')).toHaveValue('44180000-0000-4000-8000-000000000001');
 await page.getByRole('button',{name:tool,exact:true}).click();await expect(page.getByLabel('Expected quantity',{exact:true})).toBeEnabled();await expect(page.getByLabel('Team area *').locator('option')).toHaveCount(1);await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.getByRole('button',{name:'Power tool',exact:true}).click();await expect(page.getByLabel('Expected quantity',{exact:true})).toBeDisabled();await expect(page.getByLabel('Current quantity *',{exact:true})).toBeEnabled();
});

test('failed quantity RPC leaves saved count unchanged',async({page})=>{
 await signIn(page,'student');await page.goto('/#inventory');const row=page.locator('tbody tr').filter({has:page.getByRole('button',{name:tool,exact:true})});const before=await row.locator('.stepper b').textContent();
 await page.route('**/rest/v1/rpc/change_inventory_quantity',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Workspace unavailable'})}));
 await page.getByRole('button',{name:`Add one ${tool}`,exact:true}).click();await expect(page.getByRole('alert')).toContainText('Your change was not saved');await expect(row.locator('.stepper b')).toHaveText(before!);await expect(page.locator('.quantity-toast')).toHaveCount(0);
});

test('mentor can migrate local IDs transactionally and repeating migration is idempotent',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('frc-4418-inventory-v1',JSON.stringify({version:1,areas:[{id:'fabrication',name:'Fabrication',lead:'Local lead'}],locations:[{id:'local-drawer',name:'TA-99',bin:'TA-99',kind:'Drawer',room:'Robotics Lab',storage:'Toolbox A',parentId:null}],categories:['Tools'],items:[{id:'legacy-tool',name:'Local migration wrench',areaId:'fabrication',category:'Tools',quantity:2,unit:'each',minimum:1,target:4,expectedQuantity:3,locationId:'local-drawer',slot:'L1',manufacturer:'',partNumber:'',vendor:'',url:'',cost:0,notes:'Migration test',updatedAt:'2026-01-01T00:00:00Z',lastVerified:'',updatedBy:'Former student',itemType:'Tool',ownership:'Shared / School',orderStatus:'Needs Order',trackingMode:'quantity'}]}));});
 await signIn(page,'mentor');await page.goto('/#admin');
await page.getByRole('button',{name:'Preview local data',exact:true}).click();await expect(page.getByText('1 inventory items · 1 locations · 1 areas')).toBeVisible();
 page.on('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Confirm migration',exact:true}).click();await expect(page.getByText('Migration complete. Local V0 data has been kept as a backup.')).toBeVisible();
 await page.getByRole('button',{name:'Preview local data',exact:true}).click();await page.getByRole('button',{name:'Confirm migration',exact:true}).click();await expect(page.getByText('Migration complete. Local V0 data has been kept as a backup.')).toBeVisible();
 await page.goto('/#inventory');await page.getByLabel('Search inventory').fill('Local migration wrench');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody')).toContainText('TA-99');
});

test('inactive account stays protected without a separate login',async({page})=>{await signIn(page,'inactive');await expect(page.getByRole('alert')).toContainText('inactive');await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();await expect(page.locator('.auth-form')).toHaveCount(0);});

for(const width of [390,1440])test(`mentor keeps Inventory administration and follows Hub for team management ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await signIn(page,'mentor');await page.goto('/#admin');
 await page.locator('.suite-picker summary').click();await expect(page.locator('.suite-picker nav a')).toHaveCount(6);await expect(page.locator('.suite-picker nav')).toContainText('Finance');await expect(page.locator('.suite-picker nav').getByRole('link',{name:'Planning',exact:false})).toHaveAttribute('href','https://team.frc4418.org/#planning');await expect(page.locator('.suite-picker nav').getByRole('link',{name:'Competition Operations',exact:false})).toHaveAttribute('href','https://pit.frc4418.org/');await page.screenshot({path:`test-results/suite-menu-${width}.png`});await page.keyboard.press('Escape');await expect(page.locator('.suite-picker nav')).toBeHidden();
 await page.getByRole('button',{name:'Add toolbox demo',exact:true}).click();await expect(page.getByText('Toolbox demo added. Existing items were preserved.')).toBeVisible();
 await page.getByRole('button',{name:'Dismiss notification'}).click();
 await page.getByRole('button',{name:'Add toolbox demo',exact:true}).click();await expect(page.getByText('Toolbox demo added. Existing items were preserved.')).toBeVisible();
 await expect(page.getByRole('link',{name:'Open Team Management →'})).toHaveAttribute('href','https://team.frc4418.org/#team-management');
 await expect(page.locator('.profile-form')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/team-management-link-${width}.png`,fullPage:true});
 await page.goto('/#inventory');await page.getByLabel('Search inventory').fill('5/64');await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:'5/64" Allen wrench',exact:true}).click();await expect(page.getByRole('combobox',{name:/^Team area/})).toHaveValue('44180000-0000-4000-8000-000000000001');
});


test('dashboard invitation callback accepts the token fragment and sets a password',async({page,request})=>{
 await page.route('https://team.frc4418.org/',r=>r.fulfill({contentType:'text/html',body:'<h1>My 4418</h1>'}));
 const response=await request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password',{data:{email:'readonly@example.test',password:'test-password'}});const session=await response.json();
 const fragment=new URLSearchParams({access_token:session.access_token,refresh_token:session.refresh_token,expires_in:'3600',token_type:'bearer',type:'invite'});
 await page.goto('/#'+fragment.toString());await expect(page.getByRole('heading',{name:'Set your password',exact:true})).toBeVisible();
 await page.getByLabel('New password',{exact:true}).fill('new-test-password');await page.getByLabel('Confirm password',{exact:true}).fill('new-test-password');await page.getByRole('button',{name:'Save password',exact:true}).click();
 await expect(page).toHaveURL('https://team.frc4418.org/');expect(page.url()).not.toContain('access_token');
});

test('mentor can change team area without changing item location or quantity',async({page})=>{
 await signIn(page,'mentor');await page.goto('/#inventory');
 await page.getByRole('button',{name:'Power tool',exact:true}).click();
 const location=await page.getByLabel('Location / Bin').inputValue();
 const quantity=await page.getByLabel('Current quantity *',{exact:true}).inputValue();
 await page.getByLabel('Team area *').selectOption({label:'Software'});
 await expect(page.getByLabel('Location / Bin')).toHaveValue(location);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.reload();await page.getByRole('button',{name:'Power tool',exact:true}).click();
 await expect(page.getByLabel('Team area *').locator('option:checked')).toHaveText('Software');
 await expect(page.getByLabel('Location / Bin')).toHaveValue(location);
 await expect(page.getByLabel('Current quantity *',{exact:true})).toHaveValue(quantity);
});
