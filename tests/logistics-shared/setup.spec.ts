import {test,expect,type Page} from '../browser-fixtures';
async function login(page:Page,role='mentor',route='/#setup'){
 const response=await page.request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password',{data:{email:role+'@example.test',password:'test-password'}}),session=await response.json();
 await page.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),session);await page.goto(route);await expect(page.getByRole('button',{name:'Inventory',exact:true})).toBeVisible();return session;
}
test('authenticated deep link preserves target through sign-in and scanner cannot alter counts',async({page})=>{
 const route='/#location/10000000-0000-4000-8000-000000000001';
 await page.route('https://team.frc4418.org/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Team sign in</h1>'}));
 await page.goto(route);await expect(page).toHaveURL('https://team.frc4418.org/?inventory_location=10000000-0000-4000-8000-000000000001');await expect(page.getByRole('heading',{name:'Team sign in'})).toBeVisible();await login(page,'student',route);await expect(page).toHaveURL(/#location\/10000000/);await expect(page.getByRole('heading',{name:'Drawer audit'})).toBeVisible();
 await page.goto('/#labels/10000000-0000-4000-8000-000000000001');const barcode=page.locator('.location-barcode');await expect(barcode).toBeVisible();const code=(await barcode.getAttribute('aria-label'))!.replace('Code 128 ','');await page.goto('/#locations');await page.getByLabel('Scan location label').fill(code);await page.getByLabel('Scan location label').press('Enter');await expect(page.getByRole('heading',{name:'Drawer audit'})).toBeVisible();
});
test('student can verify a local balance, but restock policy remains assigned-lead metadata',async({page})=>{
 await login(page,'student');await page.getByLabel('Show ready items too').check();await page.getByRole('button',{name:/5\/32.*Allen wrench/}).click();await expect(page.locator('.setup-detail').getByRole('combobox',{name:'Restock policy',exact:true})).toBeDisabled();
 const home=page.locator('.setup-count-row').filter({has:page.getByRole('spinbutton',{name:'Count 5/32" Allen wrench at TA-01',exact:true})});
 const project=page.locator('.setup-count-row').filter({has:page.getByRole('spinbutton',{name:'Count 5/32" Allen wrench at Drivebase Prototype',exact:true})});
 await expect(home).toHaveCount(1);await expect(project).toHaveCount(1);await expect(project).toContainText('1 each recorded here');
 await home.getByRole('spinbutton').fill('4');await home.getByRole('checkbox',{name:'I physically counted this location',exact:true}).check();await home.getByRole('button',{name:'Save verified count',exact:true}).click();
 await expect(page.getByText('Count saved and verified for this location.')).toBeVisible();await expect(home).toContainText('4 each recorded here');await expect(project).toContainText('1 each recorded here');
});
test('lead can configure own area but cannot change another area policy',async({page})=>{
 await login(page,'lead');await page.getByLabel('Show ready items too').check();await page.getByRole('button',{name:/5\/32.*Allen wrench/}).click();await page.locator('.setup-detail').getByRole('combobox',{name:'Restock policy',exact:true}).selectOption('do_not_restock');await page.getByRole('button',{name:'Save restock settings'}).click();await expect(page.locator('.setup-detail').getByRole('combobox',{name:'Restock policy',exact:true})).toHaveValue('do_not_restock');
 await page.getByRole('combobox',{name:'Area',exact:true}).selectOption('');await page.getByRole('button',{name:/Power tool/}).click();await expect(page.locator('.setup-detail').getByRole('combobox',{name:'Restock policy',exact:true})).toBeDisabled();
});
test('readonly can scan but cannot count or set policy',async({page})=>{
 await login(page,'readonly');await page.getByLabel('Show ready items too').check();await page.getByRole('button',{name:/5\/32.*Allen wrench/}).click();const saves=page.getByRole('button',{name:'Save verified count',exact:true});await expect(saves).not.toHaveCount(0);for(const save of await saves.all())await expect(save).toBeDisabled();await expect(page.locator('.setup-detail').getByRole('combobox',{name:'Restock policy',exact:true})).toBeDisabled();await expect(page.getByLabel('Scan location label')).toBeEnabled();
});
