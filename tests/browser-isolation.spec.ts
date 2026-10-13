import { createServer, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { test, expect, isLoopbackURL, NetworkIsolation } from './browser-fixtures';
import type { BrowserContext, Route } from '@playwright/test';

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
let sockets: WebSocketServer;
test.beforeAll(async () => {
  server = createServer((_request, response) => { response.writeHead(302, { Location: remote }); response.end(); });
  sockets = new WebSocketServer({ server });
  sockets.on('connection', socket => socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary })));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing local redirect server');
  redirectURL = `http://127.0.0.1:${address.port}/redirect`;
});
test.afterAll(async () => {
  for (const socket of sockets.clients) socket.terminate();
  await new Promise<void>(resolve => sockets.close(() => resolve()));
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

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


test('loopback realtime keeps native subprotocols and ordered text/binary frames', async ({ page }) => {
  const result = await page.evaluate(url => new Promise<{ protocol: string; frames: unknown[] }>((resolve, reject) => {
    const socket = new WebSocket(url, ['phoenix', 'synthetic-test']);
    socket.binaryType = 'arraybuffer';
    const frames: unknown[] = [];
    socket.onopen = () => { socket.send('synthetic-first'); socket.send(new Uint8Array([4, 4, 1, 8])); };
    socket.onerror = () => reject(Error('Local WebSocket failed'));
    socket.onmessage = event => {
      frames.push(typeof event.data === 'string' ? event.data : Array.from(new Uint8Array(event.data)));
      if (frames.length === 2) { const protocol = socket.protocol; socket.close(); resolve({ protocol, frames }); }
    };
  }), redirectURL.replace('http:', 'ws:'));
  expect(result).toEqual({ protocol: 'phoenix', frames: ['synthetic-first', [4, 4, 1, 8]] });
});

test('unmocked remote WebSocket fails even when its close event is handled', async ({ page, networkIsolation }) => {
  await page.evaluate(() => new Promise<void>(resolve => {
    const socket = new WebSocket('wss://production.invalid/socket');
    socket.onerror = () => resolve();
    socket.onclose = () => resolve();
  }));
  expect(networkIsolation.violations).toHaveLength(1);
  expect(networkIsolation.violations[0]).toContain('blocked WebSocket');
  test.fail();
});


test('guarded context drains response cleanup before closing and keeps routing installed', async () => {
  const order: string[] = [];
  let handler!: (route: Route) => Promise<void>;
  let releaseFetch!: (value: unknown) => void;
  let releaseDispose!: () => void;
  const fetched = new Promise(resolve => { releaseFetch = resolve; });
  const disposed = new Promise<void>(resolve => { releaseDispose = resolve; });
  const context = {
    request: { fetch: async () => { throw Error('Unused API helper'); } },
    route: async (_pattern: string, callback: typeof handler) => { handler = callback; },
    routeWebSocket: async (pattern: RegExp) => {
      expect(pattern).toBeInstanceOf(RegExp);
      expect(pattern.test('ws://127.0.0.1:54329/realtime')).toBe(false);
      expect(pattern.test('wss://production.invalid/realtime')).toBe(true);
    },
    close: async () => { order.push('context closed'); },
  } as unknown as BrowserContext;
  await new NetworkIsolation().protectContext(context);
  const work = handler({
    request: () => ({ url: () => 'http://127.0.0.1:54329/local' }),
    fetch: () => fetched,
    fulfill: async () => { order.push('fulfilled'); },
  } as unknown as Route);
  const closing = context.close();
  releaseFetch({ status: () => 200, dispose: async () => { order.push('disposing'); await disposed; order.push('disposed'); } });
  await expect.poll(() => order).toEqual(['fulfilled', 'disposing']);
  releaseDispose();
  await Promise.all([work, closing]);
  expect(order).toEqual(['fulfilled', 'disposing', 'disposed', 'context closed']);
});
