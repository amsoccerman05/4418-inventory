import {test, expect, type Page} from '@playwright/test';

// Local Auth/REST contract fixture only. Intercept reads to exercise errors and
// empty results; these tests must not create, change, or delete inventory data.
const inventoryReads = /\/rest\/v1\/inventory_items(?:\?|$)/;
const drawer = '10000000-0000-4000-8000-000000000001';
const tool = '5/32" Allen wrench';
const rawDetail = 'Internal relation private_inventory_debug_123 could not be read';
const navigationKey = 'frc-4418-inventory-navigation-v1';
// The installed PostgREST client retries idempotent 503/network failures three
// times after 1s, 2s and 4s. Wait for the observed error state beyond that 7s
// policy rather than disabling SDK retries or sleeping a fixed amount of time.
const readFailureTimeout = 15_000;

function watchInventoryWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/rest/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !request.url().includes('/rpc/inventory_features')) writes.push(`${request.method()} ${request.url()}`);
  });
  return writes;
}
async function signIn(page: Page, role: 'student' | 'readonly', ready = true) {
  await page.goto('/#inventory');
  await expect(page.getByRole('heading', {name: 'Inventory sign in', exact: true})).toBeVisible();
  await page.getByLabel('Team account email').fill(`${role}@example.test`);
  await page.getByLabel('Password', {exact: true}).fill('test-password');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  if (ready) await expect(page.getByRole('heading', {name: 'Inventory', exact: true})).toBeVisible();
}
async function openFilters(page: Page) {
  const filters = page.locator('details.inventory-filters');
  if (await filters.getAttribute('open') === null) await filters.locator('summary').click();
}
async function expectRememberedFilters(page: Page, search: string) {
  await expect(page.getByLabel('Search inventory')).toHaveValue(search);
  await expect(page.getByLabel('Filter by location', {exact: true})).toHaveValue(drawer);
  await expect(page.getByLabel('Filter by item type', {exact: true})).toHaveValue('Tool');
}
async function expectFitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [390, 1440]) {
  test(`failed refresh and reload keep typed search and filters until recovery at ${width}px`, async ({page}, testInfo) => {
    await page.setViewportSize({width, height: 844});
    const writes = watchInventoryWrites(page);
    await signIn(page, 'student');
    await openFilters(page);
    const search = 'wrench, ALLEN 5/32';
    await page.getByLabel('Search inventory').fill(search);
    await page.getByLabel('Filter by location', {exact: true}).selectOption(drawer);
    await page.getByLabel('Filter by item type', {exact: true}).selectOption('Tool');
    await expect(page.locator('.inventory-results tbody tr')).toHaveCount(1);
    await page.locator('details.inventory-filters summary').click();

    await page.route(inventoryReads, route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'TEMPORARY_FAILURE', message: rawDetail})}));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const failure = page.getByRole('alert', {name: 'Could not load inventory', exact: true});
    await expect(failure).toBeVisible({timeout: readFailureTimeout});
    await expect(failure).toContainText('Showing the last successfully loaded inventory; it may be out of date.');
    await expect(failure).toContainText('Your search and filters are kept when you retry.');
    await expect(page.getByText(rawDetail, {exact: false})).toHaveCount(0);
    await expectRememberedFilters(page, search);
    await expect(page.getByRole('button', {name: tool, exact: true})).toBeVisible();
    await expect(page.locator('details.inventory-filters')).not.toHaveAttribute('open');
    await expectFitsViewport(page);
    await page.screenshot({path: testInfo.outputPath(`refresh-error-${width}.png`), fullPage: true});

    // Retry only repeats a read, and a continuing outage does not discard input.
    await failure.getByRole('button', {name: 'Retry loading inventory', exact: true}).click();
    await expect(failure.getByRole('button', {name: 'Retry loading inventory', exact: true})).toBeEnabled({timeout: readFailureTimeout});
    await expectRememberedFilters(page, search);
    await page.reload();
    await expect(page.getByRole('alert', {name: 'Could not load inventory', exact: true})).toBeVisible({timeout: readFailureTimeout});
    await expect(page.locator('.inventory-results')).toHaveCount(0);
    await expect(page.getByRole('heading', {name: 'No inventory items available', exact: true})).toHaveCount(0);
    expect(await page.evaluate(key => sessionStorage.getItem(key), navigationKey)).toContain(search);

    await page.unroute(inventoryReads);
    await page.getByRole('button', {name: 'Retry loading inventory', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Inventory', exact: true})).toBeVisible();
    await expect(page.locator('.read-error')).toHaveCount(0);
    await expectRememberedFilters(page, search);
    await expect(page.locator('.inventory-results tbody tr')).toHaveCount(1);
    await expect(page.getByRole('button', {name: tool, exact: true})).toBeVisible();
    await expect(page.locator('details.inventory-filters')).not.toHaveAttribute('open');
    expect(writes).toEqual([]);
  });

  test(`permission failures explain access without revealing raw details or empty inventory at ${width}px`, async ({page}, testInfo) => {
    await page.setViewportSize({width, height: 844});
    const writes = watchInventoryWrites(page);
    await page.route(inventoryReads, route => route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({code: '42501', message: rawDetail})}));
    await signIn(page, 'readonly', false);
    const failure = page.getByRole('alert', {name: 'Inventory access needs attention', exact: true});
    await expect(failure).toBeVisible({timeout: readFailureTimeout});
    await expect(failure).toContainText('Ask your lead or mentor to check your access');
    await expect(failure).toContainText('This is not an empty inventory result.');
    await expect(page.getByText(rawDetail, {exact: false})).toHaveCount(0);
    await expect(page.getByRole('button', {name: tool, exact: true})).toHaveCount(0);
    await expect(page.getByRole('heading', {name: 'No inventory items available', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Add first item', exact: true})).toHaveCount(0);
    await expectFitsViewport(page);
    await page.screenshot({path: testInfo.outputPath(`permission-error-${width}.png`), fullPage: true});
    await page.unroute(inventoryReads);
    await failure.getByRole('button', {name: 'Retry loading inventory', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Inventory', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: `Add one ${tool}`, exact: true})).toBeDisabled();
    await expect(page.getByRole('button', {name: 'Add item', exact: true})).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test(`a disconnected initial read offers retry instead of a false empty result at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    const writes = watchInventoryWrites(page);
    await page.route(inventoryReads, route => route.abort('failed'));
    await signIn(page, 'student', false);
    const failure = page.getByRole('alert', {name: 'Could not connect to inventory', exact: true});
    await expect(failure).toBeVisible({timeout: readFailureTimeout});
    await expect(failure).toContainText('Check your connection and retry.');
    await expect(page.getByRole('heading', {name: 'No inventory items available', exact: true})).toHaveCount(0);
    await expectFitsViewport(page);
    await page.unroute(inventoryReads);
    await failure.getByRole('button', {name: 'Retry loading inventory', exact: true}).click();
    await expect(page.getByRole('button', {name: tool, exact: true})).toBeVisible();
    await expect(page.locator('.read-error')).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test(`readonly empty and restricted views offer safe navigation, not unavailable add actions, at ${width}px`, async ({page}, testInfo) => {
    await page.setViewportSize({width, height: 844});
    const writes = watchInventoryWrites(page);
    await page.route(inventoryReads, route => route.fulfill({status: 200, contentType: 'application/json', body: '[]'}));
    await signIn(page, 'readonly');
    await expect(page.getByRole('heading', {name: 'No inventory items available', exact: true})).toBeVisible();
    await expect(page.getByText('No items are currently available to this account. Ask your lead or mentor about missing inventory or access.', {exact: true})).toBeVisible();
    await expect(page.locator('.read-error')).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Add first item', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Add item', exact: true})).toHaveCount(0);
    await expectFitsViewport(page);
    await page.screenshot({path: testInfo.outputPath(`readonly-empty-${width}.png`), fullPage: true});
    await page.getByRole('button', {name: 'Browse locations', exact: true}).click();
    await expect(page).toHaveURL(/#locations$/);
    await page.locator('.location-card').filter({hasText: 'TA-01'}).click();
    await expect(page.getByRole('heading', {name: 'No items assigned here', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Add an item here', exact: true})).toHaveCount(0);
    await page.getByRole('button', {name: 'Browse inventory', exact: true}).click();
    await expect(page).toHaveURL(/#inventory$/);
    await page.goto('/#admin');
    await expect(page.getByText('Admin access is restricted to admins and mentors.', {exact: true})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Inventory data', exact: true})).toHaveCount(0);
    await page.getByRole('button', {name: 'Browse inventory', exact: true}).click();
    await expect(page).toHaveURL(/#inventory$/);
    await expect(page.getByRole('heading', {name: 'No inventory items available', exact: true})).toBeVisible();
    expect(writes).toEqual([]);
  });

  for (const failureCase of [
    {kind: 'permission', status: 403, code: '42501', title: 'Inventory access needs attention'},
    {kind: 'session', status: 401, code: 'PGRST301', title: 'Sign in again to refresh inventory'},
  ]) test(`loaded ${failureCase.kind} failure hides cached actions but preserves a guarded draft at ${width}px`, async ({page}, testInfo) => {
    await page.setViewportSize({width, height: 844});
    const writes = watchInventoryWrites(page);
    // A regression must be observed without actually applying a fixture write.
    await page.route('**/rest/v1/rpc/apply_inventory_changes', route => route.abort('blockedbyclient'));
    await signIn(page, 'student');
    await openFilters(page);
    const search = 'wrench ALLEN 5/32';
    await page.getByLabel('Search inventory').fill(search);
    await page.getByLabel('Filter by location', {exact: true}).selectOption(drawer);
    await page.getByLabel('Filter by item type', {exact: true}).selectOption('Tool');
    await expect(page.locator('.inventory-results tbody tr')).toHaveCount(1);
    await page.getByRole('button', {name: 'Add item', exact: true}).click();
    const draft = `Unsubmitted ${failureCase.kind} recovery draft ${width}`;
    await page.getByLabel('Item name *').fill(draft);
    await page.route(inventoryReads, route => route.fulfill({status: failureCase.status, contentType: 'application/json', body: JSON.stringify({code: failureCase.code, message: rawDetail})}));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const failure = page.getByRole('alert', {name: failureCase.title, exact: true});
    await expect(failure).toBeVisible({timeout: readFailureTimeout});
    await expect(page.getByText(rawDetail, {exact: false})).toHaveCount(0);
    await expect(page.locator('.inventory-results tbody tr')).toHaveCount(1);
    await expect(page.locator('.inventory-results tbody tr').first()).toBeHidden();
    await expect(page.getByRole('button', {name: tool, exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Add item', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: /^Add one /})).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Item name *')).toBeHidden();
    await expect(page.getByLabel('Item name *')).toHaveValue(draft);
    await expectRememberedFilters(page, search);
    await expectFitsViewport(page);
    await page.screenshot({path: testInfo.outputPath(`loaded-${failureCase.kind}-error-${width}.png`), fullPage: true});

    // Hidden controls are not the authorization boundary: stale event handlers
    // must also fail closed until a successful fresh read restores access.
    await page.locator('.modal form').dispatchEvent('submit');
    await page.getByRole('button', {name: 'Sign out', exact: true}).click();
    await expect(page.getByRole('alertdialog', {name: 'Discard unsaved changes?', exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(failure).toBeVisible();
    await expect(page.getByLabel('Item name *')).toHaveValue(draft);
    await expect(page.getByLabel('Item name *')).toBeHidden();
    expect(writes).toEqual([]);

    // A later transient failure is not evidence that access has returned. Keep
    // the access block latched across the SDK's full 503 retry sequence.
    await page.unroute(inventoryReads);
    await page.route(inventoryReads, route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'TEMPORARY_FAILURE', message: rawDetail})}));
    await failure.getByRole('button', {name: 'Retry loading inventory', exact: true}).click();
    const outage = page.getByRole('alert', {name: 'Could not load inventory', exact: true});
    await expect(outage).toBeVisible({timeout: readFailureTimeout});
    await expect(outage).toContainText('Inventory is hidden until access is verified.');
    await expect(outage).not.toContainText('Showing the last successfully loaded inventory');
    await expect(page.locator('.inventory-results tbody tr').first()).toBeHidden();
    await expect(page.getByLabel('Item name *')).toBeHidden();
    await expect(page.getByLabel('Item name *')).toHaveValue(draft);
    await expect(page.getByRole('button', {name: 'Add item', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: /^Add one /})).toHaveCount(0);
    await expectRememberedFilters(page, search);
    await page.locator('.modal form').dispatchEvent('submit');
    expect(writes).toEqual([]);

    await page.unroute(inventoryReads);
    await outage.getByRole('button', {name: 'Retry loading inventory', exact: true}).click();
    await expect(page.locator('.read-error')).toHaveCount(0);
    await expect(page.getByRole('dialog', {name: 'Add an item', exact: true})).toBeVisible();
    await expect(page.getByLabel('Item name *')).toHaveValue(draft);
    await expectRememberedFilters(page, search);
    await page.getByRole('button', {name: 'Cancel', exact: true}).click();
    await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', {name: tool, exact: true})).toBeVisible();
    await expectRememberedFilters(page, search);
    expect(writes).toEqual([]);
  });

  test(`student empty inventory offers the existing permitted add form without submitting it at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    const writes = watchInventoryWrites(page);
    await page.route(inventoryReads, route => route.fulfill({status: 200, contentType: 'application/json', body: '[]'}));
    await signIn(page, 'student');
    await expect(page.getByRole('heading', {name: 'No inventory items available', exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Add first item', exact: true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Item name *')).toBeEnabled();
    await page.getByRole('button', {name: 'Cancel', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', {name: 'No inventory items available', exact: true})).toBeVisible();
    expect(writes).toEqual([]);
  });
}

test('a concurrent inventory outage cannot mask a denied profile refresh', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 844});
  const writes = watchInventoryWrites(page);
  await signIn(page, 'student');
  const search = 'wrench 5/32';
  await page.getByLabel('Search inventory').fill(search);
  await expect(page.getByRole('button', {name: tool, exact: true})).toBeVisible();
  // Install after authentication and match only the roster list, not AuthGate's
  // individual profile read. No role or account record is changed.
  const profilesList = (url: URL) => url.pathname === '/rest/v1/profiles' && !url.searchParams.has('id');
  await page.route(inventoryReads, route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'TEMPORARY_FAILURE', message: rawDetail})}));
  await page.route(profilesList, route => route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({code: '42501', message: rawDetail})}));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const failure = page.getByRole('alert', {name: 'Inventory access needs attention', exact: true});
  await expect(failure).toBeVisible({timeout: readFailureTimeout});
  await expect(failure).toContainText('Inventory is hidden until access is verified.');
  await expect(page.getByRole('alert', {name: 'Could not load inventory', exact: true})).toHaveCount(0);
  await expect(page.getByText(rawDetail, {exact: false})).toHaveCount(0);
  await expect(page.locator('.inventory-results tbody tr')).toHaveCount(1);
  await expect(page.locator('.inventory-results tbody tr').first()).toBeHidden();
  await expect(page.getByRole('button', {name: 'Add item', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: /^Add one /})).toHaveCount(0);
  await expect(page.getByLabel('Search inventory')).toHaveValue(search);
  expect(writes).toEqual([]);

  await page.unroute(inventoryReads);
  await page.unroute(profilesList);
  await failure.getByRole('button', {name: 'Retry loading inventory', exact: true}).click();
  await expect(page.locator('.read-error')).toHaveCount(0);
  await expect(page.getByRole('button', {name: tool, exact: true})).toBeVisible();
  await expect(page.getByLabel('Search inventory')).toHaveValue(search);
  expect(writes).toEqual([]);
});
