import {test, expect, type Page} from '@playwright/test';

// These tests use only tests/mock-supabase.mjs and do not write inventory records.
const navigationKey = 'frc-4418-inventory-navigation-v1';
const drawer = '10000000-0000-4000-8000-000000000001';
const leadArea = '44180000-0000-4000-8000-000000000001';
const tool = '5/32" Allen wrench';
const savedNavigation = (page: Page) => page.evaluate(key => sessionStorage.getItem(key), navigationKey);
function watchInventoryWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/rest/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !request.url().includes('/rpc/inventory_features')) writes.push(`${request.method()} ${request.url()}`);
  });
  return writes;
}
async function signIn(page: Page, role: string) {
  await expect(page.getByRole('heading', {name: 'Inventory sign in', exact: true})).toBeVisible();
  await page.getByLabel('Team account email').fill(`${role}@example.test`);
  await page.getByLabel('Password', {exact: true}).fill('test-password');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Inventory', exact: true})).toBeVisible();
}
async function openFilters(page: Page) {
  const filters = page.locator('details.inventory-filters');
  if (await filters.getAttribute('open') === null) await filters.locator('summary').click();
}

for (const width of [390, 1440]) test(`sign-out clears saved results and a different account gets its own defaults at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 844});
  const writes = watchInventoryWrites(page);
  await page.goto('/#inventory');
  await signIn(page, 'student');
  await openFilters(page);
  await page.getByLabel('Search inventory').fill(tool);
  await page.getByLabel('Filter by location', {exact: true}).selectOption(drawer);
  await page.getByLabel('Filter by item type', {exact: true}).selectOption('Tool');
  await page.reload();
  await expect(page.getByLabel('Search inventory')).toHaveValue(tool);
  await expect(page.getByLabel('Filter by location', {exact: true})).toHaveValue(drawer);
  await page.getByRole('button', {name: 'Sign out', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Inventory sign in', exact: true})).toBeVisible();
  await expect.poll(() => savedNavigation(page)).toBeNull();
  await signIn(page, 'lead');
  await expect(page.getByLabel('Search inventory')).toHaveValue('');
  await expect(page.getByLabel('Filter by area', {exact: true})).toHaveValue(leadArea);
  await expect(page.getByLabel('Filter by location', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('Filter by item type', {exact: true})).toHaveValue('');
  await page.getByRole('button', {name: 'Sign out', exact: true}).click();
  await signIn(page, 'student');
  await expect(page.getByLabel('Search inventory')).toHaveValue('');
  await expect(page.getByLabel('Filter by area', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('Filter by location', {exact: true})).toHaveValue('');
  expect(writes).toEqual([]);
});

test('an in-session account switch clears old Inventory and location preferences without widening permissions', async ({page}) => {
  const writes = watchInventoryWrites(page);
  await page.goto('/#inventory');
  await signIn(page, 'mentor');
  await page.getByLabel('Search inventory').fill(tool);
  await page.locator('.inventory-results tbody tr').first().locator('.location-link').click();
  await expect(page).toHaveURL(new RegExp(`#location/${drawer}$`));
  await page.getByRole('button', {name: 'View inventory', exact: true}).click();
  await page.getByLabel('Search location inventory').fill('Previous account location search');
  await page.getByRole('button', {name: 'Back to results', exact: true}).click();
  const marker = 'Previous account inventory search';
  await page.getByLabel('Search inventory').fill(marker);
  await expect.poll(() => savedNavigation(page)).toContain(marker);
  // Exercise the existing SDK auth-event path without a reload or a prior sign-out.
  await page.evaluate(async () => {
    const modulePath = '/src/services/supabase.ts';
    const {supabase} = await import(modulePath);
    const {error} = await supabase.auth.signInWithPassword({email: 'readonly@example.test', password: 'test-password'});
    if (error) throw error;
  });
  await expect(page.locator('.suite-name')).toHaveText('Readonly');
  await expect(page.getByLabel('Search inventory')).toHaveValue('');
  await expect(page.getByLabel('Filter by area', {exact: true})).toHaveValue('');
  expect(await savedNavigation(page)).not.toContain(marker);
  expect(await savedNavigation(page)).not.toContain('Previous account location search');
  await expect(page.getByRole('button', {name: 'Add item', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: `Add one ${tool}`, exact: true})).toBeDisabled();
  await page.locator('.inventory-results tbody tr').filter({has: page.getByRole('button', {name: tool, exact: true})}).locator('.location-link').click();
  await expect(page.getByLabel('Search location inventory')).toHaveValue('');
  await expect(page.getByRole('button', {name: 'Drawer audit', exact: true})).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Search location inventory')).toHaveValue('');
  expect(writes).toEqual([]);
});

test('canceling guarded sign-out preserves the draft and results; explicit discard clears saved navigation', async ({page}) => {
  const writes = watchInventoryWrites(page);
  await page.goto('/#inventory');
  await signIn(page, 'student');
  await page.getByLabel('Search inventory').fill(tool);
  await page.getByRole('button', {name: 'Add item', exact: true}).click();
  const draft = 'Unsubmitted student item, not a search preference';
  await page.getByLabel('Item name *').fill(draft);
  // Dispatch the underlying action to exercise its guard while the modal owns pointer focus.
  await page.getByRole('button', {name: 'Sign out', exact: true}).dispatchEvent('click');
  await expect(page.getByRole('alertdialog', {name: 'Discard unsaved changes?'})).toBeVisible();
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  await expect(page.getByLabel('Item name *')).toHaveValue(draft);
  await expect(page.getByLabel('Search inventory')).toHaveValue(tool);
  expect(await savedNavigation(page)).not.toContain(draft);
  await page.getByRole('button', {name: 'Sign out', exact: true}).dispatchEvent('click');
  await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Inventory sign in', exact: true})).toBeVisible();
  await expect.poll(() => savedNavigation(page)).toBeNull();
  await signIn(page, 'student');
  await expect(page.getByLabel('Search inventory')).toHaveValue('');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toEqual([]);
});
