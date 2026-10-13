import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type BrowserContextOptions,
  type Route,
} from '@playwright/test';

export { expect };
export type { APIRequestContext, Page } from '@playwright/test';

// This exact existing stylesheet is synthetic in tests. No font request leaves
// the machine, and unrelated remote stylesheets still fail the test.
const fontStylesheet = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;450;500;550;600;650;700&family=Manrope:wght@400;500;600;650;700;750;800&display=swap';

export function isLoopbackURL(value: string, protocols = ['http:', 'https:']) {
  try {
    if (!/^(?:https?|wss?):\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:[/?#]|$)/.test(value)) return false;
    const url = new URL(value);
    return protocols.includes(url.protocol) && !url.username && !url.password &&
      ['127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

export class NetworkIsolation {
  readonly violations: string[] = [];
  private readonly requests = new WeakSet<APIRequestContext>();

  deny(kind: string, value: string) {
    // Never include query strings or fragments, which might contain Auth tokens.
    let target = 'invalid URL';
    try { const url = new URL(value); target = url.origin + url.pathname; } catch { /* invalid */ }
    const message = `Network isolation: blocked ${kind}: ${target}`;
    this.violations.push(message);
    return new Error(message);
  }

  assertClean() {
    expect(this.violations, 'Unexpected outbound attempts must fail, even when the app catches the network error.').toEqual([]);
  }

  protectRequest(request: APIRequestContext, baseURL?: string) {
    if (this.requests.has(request)) return;
    this.requests.add(request);
    const fetch = request.fetch.bind(request);
    // get/post/put/patch/delete/head delegate to fetch. This also guards
    // page.request and context.request, which context.route does not intercept.
    request.fetch = async (input, options = {}) => {
      const value = typeof input === 'string'
        ? (/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : new URL(input, baseURL).href)
        : input.url();
      if (!isLoopbackURL(value)) throw this.deny('API request', value);
      const response = await fetch(input, { ...options, maxRedirects: 0 });
      if (response.status() >= 300 && response.status() < 400) {
        const target = new URL(response.headers().location || value, value).href;
        await response.dispose();
        throw this.deny('API redirect', target);
      }
      return response;
    };
  }

  async protectContext(context: BrowserContext, baseURL?: string) {
    this.protectRequest(context.request, baseURL);
    const inFlight = new Set<Promise<void>>();
    const localDocumentPermissions = new Map<string, Promise<void>>();
    let shuttingDown = false;
    const handleRoute = async (route: Route) => {
      const value = route.request().url();
      if (value === fontStylesheet && !shuttingDown) {
        await route.fulfill({ contentType: 'text/css', body: '/* Fonts are local fallbacks in synthetic browser tests. */' });
        return;
      }
      if (!isLoopbackURL(value) && value !== fontStylesheet) {
        this.deny('browser request', value);
        await route.abort('blockedbyclient');
        return;
      }
      if (shuttingDown) {
        await route.abort('aborted');
        return;
      }
      // Playwright routing only guarantees interception of the first URL in a
      // redirect chain. Never let the HTTP client or browser follow a redirect.
      // Current local fixtures need none; reject local redirects too, rather
      // than weakening isolation or silently changing navigation semantics.
      const response = await route.fetch({ maxRedirects: 0 });
      try {
        if (response.status() >= 300 && response.status() < 400) {
          const target = new URL(response.headers().location || value, value).href;
          this.deny('browser redirect', target);
          await route.abort('blockedbyclient');
        } else {
          if (route.request().isNavigationRequest()) {
            // Chromium's DevTools-fulfilled document has no remote_endpoint,
            // so its address space is unknown/public even at a loopback URL.
            // Native loopback WebSockets then require Local Network Access.
            // Grant only this validated local document origin, in this disposable
            // context. HTTP/WS destination guards remain in force independently.
            const origin = new URL(value).origin;
            let granted = localDocumentPermissions.get(origin);
            if (!granted) {
              granted = context.grantPermissions(['local-network-access'], { origin });
              localDocumentPermissions.set(origin, granted);
            }
            await granted;
          }
          await route.fulfill({ response });
        }
      } finally { await response.dispose(); }
    };
    await context.route('**/*', route => {
      const work = handleRoute(route);
      inFlight.add(work);
      // Track completion without replacing the returned rejecting promise:
      // Playwright must still surface an actual route-handler failure.
      void work.then(() => inFlight.delete(work), () => inFlight.delete(work));
      return work;
    });
    const close = context.close.bind(context);
    let closing: Promise<void> | undefined;
    context.close = options => closing ??= (async () => {
      shuttingDown = true;
      const failures: unknown[] = [];
      // Keep the guard installed while draining. unrouteAll() would leave a
      // window where a background timer could initiate an unguarded request.
      while (inFlight.size) {
        for (const result of await Promise.allSettled([...inFlight])) {
          if (result.status === 'rejected') failures.push(result.reason);
        }
      }
      await close(options);
      if (failures.length) throw new AggregateError(failures, 'HTTP routes failed during guarded context teardown');
    })();
    // Match only forbidden destinations. Relaying permitted sockets through
    // route.connectToServer() changes the realtime transport's timing; native
    // passthrough preserves Phoenix framing, protocols and message ordering.
    // Use a serializable regex: a predicate function installs a catch-all
    // browser pattern and still routes allowed sockets through the test process.
    // Native browser WebSockets reject redirects (WHATWG opening handshake).
    await context.routeWebSocket(/^wss?:\/\/(?!(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:\/|$))/, async route => {
      this.deny('WebSocket', route.url());
      await route.close({ code: 1008, reason: 'Only literal loopback is allowed in tests' });
    });
  }
}

type Fixtures = {
  networkIsolation: NetworkIsolation;
  newIsolatedContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
};

export const test = base.extend<Fixtures>({
  serviceWorkers: 'block',
  networkIsolation: [async ({}, use) => {
    const isolation = new NetworkIsolation();
    await use(isolation);
    isolation.assertClean();
  }, { auto: true }],
  context: async ({ context, networkIsolation, baseURL, serviceWorkers }, use) => {
    expect(serviceWorkers, 'Service workers bypass HTTP routing and must stay blocked.').toBe('block');
    await networkIsolation.protectContext(context, baseURL);
    await use(context);
  },
  request: async ({ request, networkIsolation, baseURL }, use) => {
    networkIsolation.protectRequest(request, baseURL);
    await use(request);
  },
  newIsolatedContext: async ({ browser, contextOptions, baseURL, networkIsolation }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({ ...contextOptions, baseURL, ...options, serviceWorkers: 'block' });
      contexts.push(context);
      await networkIsolation.protectContext(context, options.baseURL || baseURL);
      return context;
    });
    for (const context of contexts) await context.close();
  },
});
