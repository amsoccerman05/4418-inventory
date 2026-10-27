import {test, expect, type Page, type Locator} from '@playwright/test';
import {demo, type Database} from '../src/data';
import {enableLogistics} from '../src/services/logistics-local';

// Every test uses an isolated demo snapshot. No shared or live records are touched.
const key = 'frc-4418-inventory-v1';
const itemName = 'Kraken X60';
const readDb = (page: Page): Promise<Database> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
const details = (page: Page) => page.locator('details').filter({has: page.locator('summary').filter({hasText: /More details/})});
const filters = (page: Page) => page.locator('details').filter({has: page.locator('summary').filter({hasText: /Filters/})});
const confirmDiscard = (page: Page) => page.getByRole('alertdialog', {name: 'Discard unsaved changes?'});
async function openItem(page: Page) {
  await page.getByRole('button', {name: itemName, exact: true}).click();
  await expect(page.getByLabel('Item name *')).toBeVisible();
}
async function expectInViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

test.beforeEach(async ({page}) => {
  await page.addInitScript(({key, db}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(db));
  }, {key, db: demo()});
});

for (const width of [320, 390]) test(`mobile results show location, photo, quantity and actions without sideways scrolling at ${width}px`, async ({page}, testInfo) => {
  await page.setViewportSize({width, height: 844});
  await page.goto('/#inventory');
  await page.getByLabel('Search inventory').fill(itemName);
  const result = page.locator('tbody tr').filter({has: page.getByRole('button', {name: itemName, exact: true})});
  await expect(result).toHaveCount(1);
  await expect(result.getByRole('img', {name: `${itemName} — no photo`})).toBeVisible();
  await expect(result).toContainText('Electrical Cabinet');
  await expect(result.locator('.stepper b')).toHaveText('8');
  for (const control of [result.getByRole('button', {name: itemName, exact: true}), result.getByRole('button', {name: `Add one ${itemName}`, exact: true}), result.getByRole('button', {name: `View details for ${itemName}`, exact: true}), result.locator('.location-link')]) {
    await expect(control).toBeVisible();
    await expectInViewport(page, control);
  }
  expect(await result.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.locator('.table-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await result.getByRole('button', {name: `Add one ${itemName}`, exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(result.locator('.stepper b')).toHaveText('9');
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  expect((await readDb(page)).items.find(i => i.name === itemName)!.quantity).toBe(8);
  await page.screenshot({path: testInfo.outputPath(`inventory-mobile-${width}.png`), fullPage: true});
  await result.getByRole('button', {name: `View details for ${itemName}`, exact: true}).click();
  await expect(page.getByLabel('Item name *')).toHaveValue(itemName);
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await result.locator('.location-link').click();
  await expect(page).toHaveURL(/#location\/e-04$/);
});

test('desktop retains its table and filters can be collapsed without clearing a selection', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/#inventory');
  await expect(page.getByRole('columnheader', {name: 'Location', exact: true})).toBeVisible();
  await expect(page.getByRole('columnheader', {name: 'Quantity', exact: true})).toBeVisible();
  await expect(filters(page)).not.toHaveAttribute('open', '');
  await expect(page.getByLabel('Filter by area')).toBeHidden();
  await filters(page).locator('summary').click();
  await page.getByLabel('Filter by item type').selectOption('Tool');
  await page.getByLabel('Filter by ownership').selectOption('BEST');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await filters(page).locator('summary').click();
  await expect(page.locator('tbody')).toContainText('BEST practice field measuring tape');
  await filters(page).locator('summary').click();
  await expect(page.getByLabel('Filter by ownership')).toHaveValue('BEST');
  await page.getByRole('button', {name: 'Clear filters', exact: true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(demo().items.length);
});

for (const width of [390, 1440]) test(`required fields lead and optional details persist at ${width}px`, async ({page}, testInfo) => {
  await page.setViewportSize({width, height: 900});
  await page.goto('/#inventory');
  await page.getByRole('button', {name: 'Add item', exact: true}).click();
  for (const label of ['Item name *', 'Team area *', 'Category *', 'Quantity *', 'Unit', 'Location / Bin']) {
    await expect(page.getByLabel(label, {exact: true})).toBeVisible();
  }
  await expect(details(page)).not.toHaveAttribute('open', '');
  await expect(page.getByLabel('Notes', {exact: true})).toBeHidden();
  await page.getByLabel('Item name *').fill('Usability synthetic item');
  await page.getByLabel('Quantity *', {exact: true}).fill('3');
  await page.getByLabel('Location / Bin').selectOption('e-04');
  await details(page).locator('summary').click();
  await page.getByLabel('Item type', {exact: true}).selectOption('Tool');
  await page.getByLabel('Ownership', {exact: true}).selectOption('BEST');
  await page.getByLabel('Expected quantity', {exact: true}).fill('4');
  await page.getByLabel('Minimum quantity', {exact: true}).fill('1');
  await page.getByLabel('Target quantity (overall)', {exact: true}).fill('6');
  await page.getByLabel('Slot / Position (optional)').fill('Student test A');
  await page.getByLabel('Manufacturer', {exact: true}).fill('Synthetic maker');
  await page.getByLabel('Manufacturer part number').fill('SYN-123');
  await page.getByLabel('Vendor', {exact: true}).fill('Synthetic supplier');
  await page.getByLabel('Product URL').fill('https://example.test/item');
  await page.getByLabel('Approx. unit cost ($)').fill('12.50');
  await page.getByLabel('Notes', {exact: true}).fill('Optional fields remain available.');
  await details(page).locator('summary').click();
  await expect(page.getByLabel('Notes', {exact: true})).toBeHidden();
  await page.screenshot({path: testInfo.outputPath(`item-basics-${width}.png`), fullPage: true});
  await page.getByRole('dialog').getByRole('button', {name: 'Add item', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = (await readDb(page)).items.find(i => i.name === 'Usability synthetic item')!;
  expect(saved).toMatchObject({quantity: 3, locationId: 'e-04', itemType: 'Tool', ownership: 'BEST', expectedQuantity: 4, minimum: 1, target: 6, slot: 'Student test A', manufacturer: 'Synthetic maker', partNumber: 'SYN-123', vendor: 'Synthetic supplier', url: 'https://example.test/item', cost: 12.5, notes: 'Optional fields remain available.'});
  await page.reload();
  await page.getByRole('button', {name: saved.name, exact: true}).click();
  await details(page).locator('summary').click();
  await expect(page.getByLabel('Notes', {exact: true})).toHaveValue(saved.notes);
  await expect(page.getByLabel('Ownership', {exact: true})).toHaveValue('BEST');
});

for (const width of [390, 1440]) for (const dismiss of ['Escape', 'Cancel', 'Close', 'Backdrop']) test(`dirty ${dismiss} offers Keep editing or Discard without saving at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  await page.goto('/#inventory');
  const before = await readDb(page);
  await openItem(page);
  await page.getByLabel('Item name *').fill('Unfinished name');
  await page.getByLabel('Quantity *', {exact: true}).fill('17');
  await details(page).locator('summary').click();
  await page.getByLabel('Notes', {exact: true}).fill('Keep this unfinished note');
  async function attemptClose() {
    if (dismiss === 'Escape') await page.keyboard.press('Escape');
    else if (dismiss === 'Backdrop') await page.locator('.modal-backdrop').first().click({position: {x: 2, y: 2}});
    else await page.getByRole('button', {name: dismiss === 'Close' ? 'Close item details' : 'Cancel', exact: true}).click();
  }
  await attemptClose();
  await expect(confirmDiscard(page)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Keep editing', exact: true})).toBeFocused();
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  await expect(confirmDiscard(page)).toHaveCount(0);
  await expect(page.getByLabel('Item name *')).toHaveValue('Unfinished name');
  await expect(page.getByLabel('Quantity *', {exact: true})).toHaveValue('17');
  await expect(page.getByLabel('Notes', {exact: true})).toHaveValue('Keep this unfinished note');
  expect(await readDb(page)).toEqual(before);
  await attemptClose();
  await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await readDb(page)).toEqual(before);
  await openItem(page);
  await expect(page.getByLabel('Item name *')).toHaveValue(itemName);
  await expect(page.getByLabel('Quantity *', {exact: true})).toHaveValue('8');
});

test('unchanged and reverted drafts close directly; Escape in the warning keeps editing', async ({page}) => {
  await page.goto('/#inventory');
  await openItem(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openItem(page);
  await page.getByLabel('Item name *').fill('Change then revert');
  await page.getByLabel('Item name *').fill(itemName);
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openItem(page);
  await page.getByLabel('Item name *').fill('Still editing');
  await page.keyboard.press('Escape');
  await expect(confirmDiscard(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirmDiscard(page)).toHaveCount(0);
  await expect(page.getByLabel('Item name *')).toHaveValue('Still editing');
});

test('duplicate navigation must not replace an unfinished new item until discard is explicit', async ({page}) => {
  await page.goto('/#location/ta-01');
  const before = await readDb(page);
  await page.getByRole('button', {name: 'Add item', exact: true}).click();
  await page.getByLabel('Item name *').fill('5/32" Allen wrench');
  await page.getByRole('button', {name: 'View existing item', exact: true}).click();
  await expect(confirmDiscard(page)).toBeVisible();
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Add an item', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'View existing item', exact: true}).click();
  await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
  await expect(page.getByRole('heading', {name: '5/32" Allen wrench', exact: true})).toBeVisible();
  await expect(page.getByLabel('Current quantity *', {exact: true})).toHaveValue('3');
  expect(await readDb(page)).toEqual(before);
});

test('browser Back and Forward protect dirty drafts and honor an explicit discard', async ({page}) => {
  await page.goto('/#locations');
  await page.getByRole('button', {name: 'Inventory', exact: true}).click();
  const before = await readDb(page);
  await openItem(page);
  await page.getByLabel('Item name *').fill('Not saved by navigation');
  await page.goBack();
  await expect(confirmDiscard(page)).toBeVisible();
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  await expect(page).toHaveURL(/#inventory$/);
  await expect(page.getByLabel('Item name *')).toHaveValue('Not saved by navigation');
  await page.goBack();
  await expect(confirmDiscard(page)).toBeVisible();
  await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
  await expect(page).toHaveURL(/#locations$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(/#inventory$/);
  expect(await readDb(page)).toEqual(before);
});

test('reload prompts for unsaved edits and rejecting reload retains the draft', async ({page}) => {
  await page.goto('/#inventory');
  const before = await readDb(page);
  await openItem(page);
  await page.getByLabel('Item name *').fill('Unfinished reload edit');
  const prompt = page.waitForEvent('dialog');
  await page.evaluate(() => setTimeout(() => location.reload(), 0));
  const dialog = await prompt;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(page.getByLabel('Item name *')).toHaveValue('Unfinished reload edit');
  expect(await readDb(page)).toEqual(before);
});

test('failed saves retain edits and still require discard; explicit verification saves only its count', async ({page}) => {
  await page.goto('/#inventory');
  await openItem(page);
  await page.getByLabel('Item name *').fill('Metadata not verified');
  await page.getByLabel('Quantity *', {exact: true}).fill('7');
  await page.getByRole('button', {name: 'Verify quantity', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: 'Quantity verified and saved.'})).toBeVisible();
  const verified = (await readDb(page)).items.find(i => i.name === itemName)!;
  expect(verified.quantity).toBe(7);
  await expect(page.getByLabel('Item name *')).toHaveValue('Metadata not verified');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(confirmDiscard(page)).toBeVisible();
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Synthetic full storage'); }; });
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic full storage');
  await expect(page.getByLabel('Item name *')).toHaveValue('Metadata not verified');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
  expect((await readDb(page)).items.find(i => i.id === verified.id)).toEqual(verified);
});

test.describe('logistics item navigation', () => {
  test.beforeEach(async ({page}) => {
    await page.goto('/');
    const db = enableLogistics(demo());
    await page.evaluate(({key, db}) => localStorage.setItem(key, JSON.stringify(db)), {key, db});
    await page.reload();
  });
  for (const destination of ['Move', 'Location']) test(`${destination} cannot silently abandon metadata`, async ({page}) => {
    await page.goto('/#inventory');
    await page.getByLabel('Search inventory').fill(itemName);
    const before = await readDb(page);
    await openItem(page);
    await page.getByLabel('Item name *').fill('Unfinished logistics edit');
    const destinationButton = destination === 'Move'
      ? page.getByRole('dialog').getByRole('button', {name: 'Move', exact: true})
      : page.getByRole('dialog').locator('.item-balances .location-link').first();
    await destinationButton.click();
    await expect(confirmDiscard(page)).toBeVisible();
    await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
    await expect(page.getByLabel('Item name *')).toHaveValue('Unfinished logistics edit');
    await expect(page.getByLabel('Search inventory')).toHaveValue(itemName);
    await destinationButton.click();
    await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
    if (destination === 'Move') await expect(page.getByRole('heading', {name: `Move ${itemName}`, exact: true})).toBeVisible();
    else {
      await expect(page).toHaveURL(/#location\/e-04$/);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    expect(await readDb(page)).toEqual(before);
  });
  test('required location is visible before optional details', async ({page}) => {
    await page.goto('/#inventory');
    await page.getByRole('button', {name: 'Add item', exact: true}).click();
    await expect(page.getByLabel('Location / Bin')).toBeVisible();
    await expect(page.getByLabel('Location / Bin')).toHaveAttribute('required', '');
    await expect(details(page)).not.toHaveAttribute('open', '');
  });
});

test('new item stays unsaved until Add item is explicitly chosen', async ({page}) => {
  await page.goto('/#inventory');
  const before = await readDb(page);
  await page.getByRole('button', {name: 'Add item', exact: true}).click();
  await page.getByLabel('Item name *').fill('Do not silently create me');
  await page.getByLabel('Quantity *', {exact: true}).fill('6');
  await page.keyboard.press('Escape');
  await expect(confirmDiscard(page)).toBeVisible();
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  await expect(page.getByLabel('Item name *')).toHaveValue('Do not silently create me');
  expect(await readDb(page)).toEqual(before);
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await readDb(page)).toEqual(before);
});

test('keyboard stays within the warning and within visible item controls', async ({page}) => {
  await page.goto('/#inventory');
  await openItem(page);
  await page.getByLabel('Item name *').fill('Keyboard-only draft');
  await page.keyboard.press('Escape');
  await expect(confirmDiscard(page)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Keep editing', exact: true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', {name: 'Discard changes', exact: true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Keep editing', exact: true})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmDiscard(page)).toHaveCount(0);
  await page.getByRole('button', {name: 'Save changes', exact: true}).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Close item details', exact: true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', {name: 'Save changes', exact: true})).toBeFocused();
});

test('hash navigation retains the original route and draft when editing continues', async ({page}) => {
  await page.goto('/#inventory');
  const before = await readDb(page);
  await openItem(page);
  await page.getByLabel('Item name *').fill('Hash navigation draft');
  await page.evaluate(() => { location.hash = 'restock'; });
  await expect(confirmDiscard(page)).toBeVisible();
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  await expect(page).toHaveURL(/#inventory$/);
  await expect(page.getByLabel('Item name *')).toHaveValue('Hash navigation draft');
  await page.evaluate(() => { location.hash = 'restock'; });
  await expect(confirmDiscard(page)).toBeVisible();
  await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
  await expect(page).toHaveURL(/#restock$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await readDb(page)).toEqual(before);
});

test('invalid optional fields reopen More details instead of blocking submission invisibly', async ({page}) => {
  await page.goto('/#inventory');
  const before = await readDb(page);
  await page.getByRole('button', {name: 'Add item', exact: true}).click();
  await page.getByLabel('Item name *').fill('Invalid optional details');
  await details(page).locator('summary').click();
  await page.getByLabel('Product URL').fill('not a URL');
  await details(page).locator('summary').click();
  await page.getByRole('dialog').getByRole('button', {name: 'Add item', exact: true}).click();
  await expect(details(page)).toHaveAttribute('open', '');
  await expect(page.getByLabel('Product URL')).toBeVisible();
  expect(await readDb(page)).toEqual(before);
});

test('duplicate history events never close an unfinished editor after Keep editing', async ({page}) => {
  await page.goto('/#inventory');
  const before = await readDb(page);
  await openItem(page);
  await page.getByLabel('Item name *').fill('Draft survives duplicate history event');
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  await page.evaluate(() => {
    window.dispatchEvent(new PopStateEvent('popstate', {state: history.state}));
    window.dispatchEvent(new HashChangeEvent('hashchange', {oldURL: location.href, newURL: location.href}));
  });
  await expect(page.getByLabel('Item name *')).toHaveValue('Draft survives duplicate history event');
  await expect(confirmDiscard(page)).toHaveCount(0);
  expect(await readDb(page)).toEqual(before);
});
