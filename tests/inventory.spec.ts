import { test, expect } from './browser-fixtures';
import { demo, exportCsv, importCsv, filterRestock } from '../src/data';

const key = 'frc-4418-inventory-v1';
test.beforeEach(async ({ page }) => {
  const data = demo();
  data.items.find(i => i.name === 'NEO Vortex')!.orderStatus = 'Ordered';
  data.items.find(i => i.name === 'Rivets')!.orderStatus = 'Received';
  await page.addInitScript(({ key, data }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, { key, data });
});

const savedItem = (page: import('@playwright/test').Page, name: string) => page.evaluate(({ key, name }) => JSON.parse(localStorage.getItem(key)!).items.find((i: { name: string }) => i.name === name), { key, name });

test('rows open details while quantity and location controls stay independent', async ({ page }) => {
  await page.goto('/#inventory');
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Kraken X60', exact: true }) });
  await row.getByRole('cell').nth(1).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close item details' }).click();
  await row.getByRole('button', { name: 'Add one Kraken X60', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.quantity-toast')).toContainText('Kraken X60: 9 each');
  await row.getByRole('button', { name: /Electrical Cabinet/ }).click();
  await expect(page).toHaveURL(/#location\/e-04$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('repeated adjustments persist and Undo reverses only the most recent change', async ({ page }) => {
  await page.goto('/#inventory');
  const plus = page.getByRole('button', { name: 'Add one Kraken X60', exact: true });
  await plus.click();
  await plus.click();
  await expect(page.locator('.quantity-toast')).toContainText('10 each');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.quantity-toast')).toContainText('Undone');
  expect((await savedItem(page, 'Kraken X60')).quantity).toBe(9);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await page.reload();
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Kraken X60', exact: true }) });
  await expect(row.locator('.stepper b')).toHaveText('9');
  await expect(page.getByRole('button', { name: 'Remove one CANivore', exact: true })).toBeDisabled();
});

test('Undo cannot overwrite a later item edit', async ({ page }) => {
  await page.goto('/#inventory');
  await page.getByRole('button', { name: 'Add one Kraken X60', exact: true }).click();
  await page.getByRole('button', { name: 'Kraken X60', exact: true }).click();
  await page.getByLabel('Quantity *', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await savedItem(page, 'Kraken X60')).quantity).toBe(20);
  await expect(page.getByRole('status')).toContainText('changed since that adjustment');
});

test('Verify quantity saves immediately, including the entered count', async ({ page }) => {
  await page.goto('/#inventory');
  await page.getByRole('button', { name: 'Kraken X60', exact: true }).click();
  await page.getByLabel('Quantity *', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Verify quantity', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Quantity verified and saved.');
  const item = await savedItem(page, 'Kraken X60');
  expect(item.quantity).toBe(7);
  expect(Date.now() - Date.parse(item.lastVerified)).toBeLessThan(10000);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Kraken X60', exact: true }).click();
  await expect(page.getByLabel('Quantity *', { exact: true })).toHaveValue('7');
  await expect(page.locator('.verification')).not.toContainText('never');
});

test('restock filters and exported CSV contain only displayed items', async ({ page }) => {
  await page.goto('/#restock');
  const restockTable = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Item / Area', exact: true }) });
  await page.getByLabel('Restock area').selectOption('power');
  await page.getByLabel('Restock order status').selectOption('Ordered');
  await expect(restockTable.locator('tbody tr')).toHaveCount(1);
  await expect(restockTable.locator('tbody')).toContainText('NEO Vortex');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export restock list' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('4418-restock.csv');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = importCsv(Buffer.concat(chunks).toString('utf8'), demo());
  expect(exported.map(i => i.name)).toEqual(['NEO Vortex']);
  expect(exported[0].orderStatus).toBe('Ordered');
  await page.getByLabel('Restock order status').selectOption('Received');
  await expect(restockTable.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByText('No items match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(restockTable.locator('tbody tr')).toHaveCount(filterRestock(demo().items).length);
});

test('existing verifiedAt data and CSV migrate without losing verification', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(key => {
    const data = JSON.parse(localStorage.getItem(key)!);
    for (const item of data.items) {
      item.verifiedAt = '2026-09-01T12:00:00.000Z';
      delete item.lastVerified;
      delete item.orderStatus;
    }
    localStorage.setItem(key, JSON.stringify(data));
  }, key);
  await page.reload();
  await expect(page.getByText('Unique items', { exact: true })).toBeVisible();
  await page.goto('/#inventory');
  await page.getByRole('button', { name: 'Add one Kraken X60', exact: true }).click();
  const item = await savedItem(page, 'Kraken X60');
  expect(item.lastVerified).toBe('2026-09-01T12:00:00.000Z');
  expect(item.orderStatus).toBe('Needs Order');
  expect(item).not.toHaveProperty('verifiedAt');
  const db = demo();
  db.items[0].lastVerified = '2026-09-01T12:00:00.000Z';
  expect(importCsv(exportCsv([db.items[0]]).replace('lastVerified', 'verifiedAt'), db)[0].lastVerified).toBe(db.items[0].lastVerified);
});

test('failed saves leave quantities unchanged and never offer Undo', async ({ page }) => {
  await page.goto('/#inventory');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Storage is full'); }; });
  await page.getByRole('button', { name: 'Add one Kraken X60', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Storage is full');
  await expect(page.locator('.quantity-toast')).toHaveCount(0);
  expect((await savedItem(page, 'Kraken X60')).quantity).toBe(8);
});

test('mobile controls and toast fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#inventory');
  await page.getByLabel('Search inventory').fill('bearing');
  await page.getByRole('button', { name: 'Remove one 1/2" hex bearings', exact: true }).click();
  const toast = page.locator('.quantity-toast');
  await expect(toast).toContainText('47 each');
  const bounds = await toast.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(toast).toContainText('Undone');
  expect((await savedItem(page, '1/2" hex bearings')).quantity).toBe(48);
});
