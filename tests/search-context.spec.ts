import {test, expect, type Page} from '@playwright/test';
import {demo, type Database} from '../src/data';

// These tests only read a per-browser demo snapshot; no shared records are used.
const dataKey = 'frc-4418-inventory-v1';
const navigationKey = 'frc-4418-inventory-navigation-v1';
const filterValues = {
  'Filter by area': 'power',
  'Filter by category': 'Motors & motion',
  'Filter by location': 'e-04',
  'Filter by stock status': 'GOOD',
  'Filter by item type': 'Part',
  'Filter by ownership': 'FRC 4418',
};
const filters = (page: Page) => page.locator('details.inventory-filters');
const readDb = (page: Page) => page.evaluate(key => localStorage.getItem(key), dataKey);
const savedNavigation = (page: Page) => page.evaluate(key => sessionStorage.getItem(key), navigationKey);
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
async function expectScroll(page: Page, expected: number) {
  await expect.poll(async () => Math.abs(await scrollY(page) - expected)).toBeLessThanOrEqual(4);
}
async function expectFilters(page: Page, values: Record<string, string> = filterValues) {
  for (const [label, value] of Object.entries(values)) await expect(page.getByLabel(label, {exact: true})).toHaveValue(value);
}
function fixture(): Database {
  const db = demo();
  const template = db.items.find(item => item.name === 'Kraken X60')!;
  db.items.push(...Array.from({length: 60}, (_, index) => ({
    ...template, id: `context-${index + 1}`, name: `Context motor ${String(index + 1).padStart(2, '0')}`,
  })));
  return db;
}
test.beforeEach(async ({page}) => {
  await page.addInitScript(({key, db}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(db));
  }, {key: dataKey, db: fixture()});
});

for (const width of [390, 1440]) test(`search, every filter and list position survive details, location, history and reload at ${width}px`, async ({page}, testInfo) => {
  await page.setViewportSize({width, height: 844});
  await page.goto('/#inventory');
  const before = await readDb(page);
  await page.getByLabel('Search inventory').fill('Context motor');
  await filters(page).locator('summary').click();
  for (const [label, value] of Object.entries(filterValues)) await page.getByLabel(label, {exact: true}).selectOption(value);
  await expect(page.locator('.inventory-results tbody tr')).toHaveCount(60);
  const row = page.locator('.inventory-results tbody tr').filter({has: page.getByRole('button', {name: 'Context motor 30', exact: true})});
  await row.scrollIntoViewIfNeeded();
  const position = await scrollY(page);
  expect(position).toBeGreaterThan(500);
  await row.getByRole('button', {name: 'View details for Context motor 30', exact: true}).click();
  await expect(page.getByLabel('Item name *')).toHaveValue('Context motor 30');
  await page.getByRole('dialog').getByRole('button', {name: 'Back to results', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectScroll(page, position);
  await expect(page.getByLabel('Search inventory')).toHaveValue('Context motor');
  await expectFilters(page);
  await expect(filters(page)).toHaveAttribute('open', '');

  await row.locator('.location-link').click();
  await expect(page).toHaveURL(/#location\/e-04$/);
  await expect(page.getByRole('button', {name: 'Back to results', exact: true})).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#inventory$/);
  await expectFilters(page);
  await expectScroll(page, position);
  await page.goForward();
  await expect(page).toHaveURL(/#location\/e-04$/);
  await page.getByRole('button', {name: 'Back to results', exact: true}).click();
  await expect(page).toHaveURL(/#inventory$/);
  await expectFilters(page);
  await expectScroll(page, position);

  await page.reload();
  await expect(page.getByLabel('Search inventory')).toHaveValue('Context motor');
  await expectFilters(page);
  await expect(filters(page)).toHaveAttribute('open', '');
  await expectScroll(page, position);
  expect(await readDb(page)).toBe(before);
  await page.screenshot({path: testInfo.outputPath(`retained-results-${width}.png`)});

  // Collapsing the filters is a view preference, not a reset of their values.
  await filters(page).locator('summary').click();
  await page.reload();
  await expect(filters(page)).not.toHaveAttribute('open', '');
  await expectFilters(page);
  await expect(page.locator('.inventory-results tbody tr')).toHaveCount(60);
});

for (const width of [390, 1440]) test(`location searches and filters remain independent through Back, Forward and refresh at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 844});
  await page.goto('/#location/e-04');
  const before = await readDb(page);
  const {['Filter by location']: _unused, ...locationFilters} = filterValues;
  await page.getByLabel('Search location inventory').fill('Context motor');
  for (const [label, value] of Object.entries(locationFilters)) await page.getByLabel(label, {exact: true}).selectOption(value);
  const row = page.locator('.location-detail tbody tr').filter({has: page.getByRole('button', {name: 'Context motor 30', exact: true})});
  await row.scrollIntoViewIfNeeded();
  const position = await scrollY(page);
  await row.getByRole('button', {name: 'Context motor 30', exact: true}).click();
  await page.getByRole('dialog').getByRole('button', {name: 'Back to results', exact: true}).click();
  await expectScroll(page, position);
  await page.evaluate(() => { location.hash = 'location/e-02'; });
  await expect(page.getByLabel('Search location inventory')).toHaveValue('');
  await page.getByLabel('Search location inventory').fill('CANivore');
  await page.getByLabel('Filter by category', {exact: true}).selectOption('Electronics');
  await page.getByLabel('Filter by stock status', {exact: true}).selectOption('OUT');
  await expect(page.locator('.location-detail tbody tr')).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/#location\/e-04$/);
  await expect(page.getByLabel('Search location inventory')).toHaveValue('Context motor');
  await expectFilters(page, locationFilters);
  await expectScroll(page, position);
  await page.goForward();
  await expect(page).toHaveURL(/#location\/e-02$/);
  await expect(page.getByLabel('Search location inventory')).toHaveValue('CANivore');
  await expect(page.getByLabel('Filter by category', {exact: true})).toHaveValue('Electronics');
  await expect(page.getByLabel('Filter by stock status', {exact: true})).toHaveValue('OUT');
  await page.reload();
  await expect(page.getByLabel('Search location inventory')).toHaveValue('CANivore');
  await expect(page.locator('.location-detail tbody tr')).toHaveCount(1);
  await page.getByRole('button', {name: 'Clear filters', exact: true}).click();
  await expect(page.getByLabel('Search location inventory')).toHaveValue('');
  await page.reload();
  await expect(page.getByLabel('Search location inventory')).toHaveValue('');
  await expect(page.getByLabel('Filter by category', {exact: true})).toHaveValue('');
  await page.goBack();
  await expect(page.getByLabel('Search location inventory')).toHaveValue('Context motor');
  await expectFilters(page, locationFilters);
  expect(await readDb(page)).toBe(before);
});

test('drawer view preference and location filters survive navigation without persisting audit edits', async ({page}) => {
  await page.goto('/#location/ta-01');
  const before = await readDb(page);
  await page.getByRole('button', {name: 'View inventory', exact: true}).click();
  await page.getByLabel('Search location inventory').fill('Allen');
  await page.getByLabel('Filter by item type', {exact: true}).selectOption('Tool');
  await page.reload();
  await expect(page.getByRole('button', {name: 'Drawer audit', exact: true})).toBeVisible();
  await expect(page.getByLabel('Search location inventory')).toHaveValue('Allen');
  await expect(page.getByLabel('Filter by item type', {exact: true})).toHaveValue('Tool');
  await page.getByRole('button', {name: 'Drawer audit', exact: true}).click();
  await page.reload();
  await expect(page.getByRole('button', {name: 'View inventory', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'View inventory', exact: true}).click();
  await expect(page.getByLabel('Search location inventory')).toHaveValue('Allen');
  expect(await readDb(page)).toBe(before);
});

for (const width of [390, 1440]) test(`Back to results keeps the unsaved-change guard and never stores form drafts at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 844});
  await page.goto('/#inventory');
  const before = await readDb(page);
  await page.getByLabel('Search inventory').fill('Kraken');
  await page.getByRole('button', {name: 'Kraken X60', exact: true}).click();
  const draft = 'Private unfinished metadata, never a search preference';
  await page.getByLabel('Item name *').fill(draft);
  await page.locator('summary').filter({hasText: /More details/}).click();
  await page.getByLabel('Notes', {exact: true}).fill(draft);
  const back = page.getByRole('dialog').getByRole('button', {name: 'Back to results', exact: true});
  await back.click();
  await expect(page.getByRole('alertdialog', {name: 'Discard unsaved changes?'})).toBeVisible();
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  await expect(page.getByLabel('Item name *')).toHaveValue(draft);
  expect(await savedNavigation(page)).not.toContain(draft);
  expect(await readDb(page)).toBe(before);
  await back.click();
  await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Search inventory')).toHaveValue('Kraken');
  await page.getByRole('button', {name: 'Kraken X60', exact: true}).click();
  await expect(page.getByLabel('Item name *')).toHaveValue('Kraken X60');
  expect(await savedNavigation(page)).not.toContain(draft);
  expect(await readDb(page)).toBe(before);
});

test('accepting a guarded reload restores only results, not an unfinished item form', async ({page}) => {
  await page.goto('/#inventory');
  const before = await readDb(page);
  await page.getByLabel('Search inventory').fill('Kraken');
  await page.getByRole('button', {name: 'Kraken X60', exact: true}).click();
  await page.getByLabel('Item name *').fill('Never restored after explicit reload');
  const dialog = page.waitForEvent('dialog');
  await page.evaluate(() => setTimeout(() => location.reload(), 0));
  const prompt = await dialog;
  expect(prompt.type()).toBe('beforeunload');
  await prompt.accept();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Search inventory')).toHaveValue('Kraken');
  expect(await savedNavigation(page)).not.toContain('Never restored after explicit reload');
  expect(await readDb(page)).toBe(before);
});
