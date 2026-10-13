import { createServer, type Server } from 'node:http';
import { test, expect, isLoopbackURL } from './browser-fixtures';

// Reserved .invalid avoids contacting a real site even if a future guard regresses.
const remote = 'https://production.invalid/';
const gateway = 'https://team.frc4418.org/';

test('isolation allows only literal loopback destinations', () => {
  for (const url of ['http://127.0.0.1:5174/', 'http://[::1]:5174/']) expect(isLoopbackURL(url)).toBe(true);
  for (const url of [remote, 'http://localhost:5174/', 'http://2130706433:5174/', 'http://127.1:5174/', 'http://127.0.0.1.evil.test/', 'http://user@127.0.0.1:5174/']) expect(isLoopbackURL(url)).toBe(false);
});

test('explicit synthetic gateway mocks still work without remote access', async ({ page, networkIsolation, serviceWorkers }) => {
  expect(serviceWorkers).toBe('block');
  await page.route(gateway, route => route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic Team Hub</h1>' }));
  await page.goto(gateway);
  await expect(page.getByRole('heading')).toHaveText('Synthetic Team Hub');
  expect(networkIsolation.violations).toEqual([]);
});

// These intentionally expect a test failure from fixture teardown. Catching the
// navigation/API error cannot make an unexpected outbound attempt pass. If the
// guard merely aborts without recording a test failure, they unexpectedly pass
// and Playwright fails the suite. The positive case above proves the browser ran.
test('unmocked production navigation fails even when its error is caught', async ({ page, networkIsolation }) => {
  await page.goto(remote).catch(() => {});
  expect(networkIsolation.violations).toHaveLength(1);
  expect(networkIsolation.violations[0]).toContain('blocked browser request');
  test.fail();
});

test('an additional device context cannot escape to production', async ({ newIsolatedContext, networkIsolation }) => {
  const context = await newIsolatedContext();
  const page = await context.newPage();
  await page.goto(remote).catch(() => {});
  expect(networkIsolation.violations).toHaveLength(1);
  test.fail();
});

test('API helpers cannot escape to production even when errors are caught', async ({ request, networkIsolation }) => {
  await request.get(remote).catch(() => {});
  expect(networkIsolation.violations).toHaveLength(1);
  expect(networkIsolation.violations[0]).toContain('blocked API request');
  test.fail();
});

let server: Server;
let redirectURL: string;
test.beforeAll(async () => {
  server = createServer((_request, response) => { response.writeHead(302, { Location: remote }); response.end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing local redirect server');
  redirectURL = `http://127.0.0.1:${address.port}/redirect`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

test('local HTTP redirect cannot escape to production', async ({ page, networkIsolation }) => {
  await page.goto(redirectURL).catch(() => {});
  expect(networkIsolation.violations).toHaveLength(1);
  expect(networkIsolation.violations[0]).toContain('blocked browser redirect');
  test.fail();
});

test('API helper disables automatic redirects before inspecting the response', async ({ request, networkIsolation }) => {
  await request.get(redirectURL).catch(() => {});
  expect(networkIsolation.violations).toHaveLength(1);
  expect(networkIsolation.violations[0]).toContain('blocked API redirect');
  test.fail();
});
