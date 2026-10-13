import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type BrowserContextOptions,
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
    await context.route('**/*', async route => {
      const value = route.request().url();
      if (value === fontStylesheet) {
        await route.fulfill({ contentType: 'text/css', body: '/* Fonts are local fallbacks in synthetic browser tests. */' });
        return;
      }
      if (!isLoopbackURL(value)) {
        this.deny('browser request', value);
        await route.abort('blockedbyclient');
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
        } else await route.fulfill({ response });
      } finally { await response.dispose(); }
    });
    await context.routeWebSocket('**/*', route => {
      if (!isLoopbackURL(route.url(), ['ws:', 'wss:'])) {
        this.deny('WebSocket', route.url());
        route.close({ code: 1008, reason: 'Only literal loopback is allowed in tests' });
      } else route.connectToServer();
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
