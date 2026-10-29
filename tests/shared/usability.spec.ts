import {test, expect, type Page} from '@playwright/test';

// Auth and data come exclusively from the local mock Supabase fixture.
async function signIn(page: Page, role: string) {
  const response = await page.request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password', {
    data: {email: `${role}@example.test`, password: 'test-password'},
  });
  const session = await response.json();
  await page.addInitScript(session => localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), session);
  await page.goto('/#inventory');
  await expect(page.getByRole('heading', {name: 'Inventory', exact: true})).toBeVisible();
}

for (const role of ['student', 'readonly', 'lead', 'mentor']) test(`${role} keeps item permissions in mobile cards and optional form fields`, async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await signIn(page, role);
  const tool = '5/32" Allen wrench';
  await page.getByLabel('Search inventory').fill(tool);
  const row = page.locator('tbody tr').filter({has: page.getByRole('button', {name: tool, exact: true})});
  await expect(row).toHaveCount(1);
  expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  if (role === 'readonly') {
    await expect(page.getByRole('button', {name: 'Add item', exact: true})).toHaveCount(0);
    await expect(row.getByRole('button', {name: `Add one ${tool}`, exact: true})).toBeDisabled();
  } else {
    await expect(page.getByRole('button', {name: 'Add item', exact: true})).toBeEnabled();
    await expect(row.getByRole('button', {name: `Add one ${tool}`, exact: true})).toBeEnabled();
  }
  await row.getByRole('button', {name: `View details for ${tool}`, exact: true}).click();
  await page.locator('summary').filter({hasText: /More details/}).click();
  if (role === 'readonly') {
    await expect(page.getByLabel('Item name *')).toBeDisabled();
    await expect(page.getByLabel('Expected quantity', {exact: true})).toBeDisabled();
    await expect(page.getByRole('button', {name: 'Delete item', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Save changes', exact: true})).toHaveCount(0);
  } else {
    await expect(page.getByLabel('Item name *')).toBeEnabled();
    await expect(page.getByLabel('Expected quantity', {exact: true})).toBeEnabled();
    if(role==='student')await expect(page.getByRole('button', {name: 'Delete item', exact: true})).toHaveCount(0);
    else await expect(page.getByRole('button', {name: 'Delete item', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Save changes', exact: true})).toBeVisible();
  }
  if (role === 'readonly') await expect(page.getByLabel('Current quantity *', {exact: true})).toBeDisabled();
  else await expect(page.getByLabel('Current quantity *', {exact: true})).toBeEnabled();
});

test('student can keep or discard an unfinished new item without submitting it', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await signIn(page, 'student');
  await page.getByRole('button', {name: 'Add item', exact: true}).click();
  await expect(page.getByLabel('Item name *')).toBeEnabled();
  await page.getByLabel('Item name *').fill('Unsubmitted student form');
  await page.locator('summary').filter({hasText: /More details/}).click();
  await expect(page.getByLabel('Notes', {exact: true})).toBeEnabled();
  await page.getByLabel('Notes', {exact: true}).fill('Do not save on cancel');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog', {name: 'Discard unsaved changes?'})).toBeVisible();
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  await expect(page.getByLabel('Notes', {exact: true})).toHaveValue('Do not save on cancel');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
  await page.reload();
  await page.getByLabel('Search inventory').fill('Unsubmitted student form');
  await expect(page.locator('tbody tr')).toHaveCount(0);
});
