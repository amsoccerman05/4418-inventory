import assert from 'node:assert/strict';
import { request as directRequest, Agent } from 'node:http';
const directAgent = new Agent({ keepAlive: false, proxyEnv: {} });

export const CLI_VERSION = '2.119.0';
export const API_PORT = 54331;
export const DB_PORT = 54332;
export const ORIGIN = 'http://127.0.0.1:54339';

// Literal loopback only: no DNS aliases, shorthand/octal IPv4, credentials, or redirects.
export function localURL(value, { database = false } = {}) {
  assert.equal(typeof value, 'string', 'A local URL is required');
  assert(!/[\\\s\u0000-\u001f]/.test(value), 'Unsafe URL characters');
  const pattern = database
    ? /^postgres(?:ql)?:\/\/postgres:postgres@(127\.0\.0\.1|localhost|\[::1\]):[0-9]+\/postgres$/
    : /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):[0-9]+(?:\/[^?#]*)?$/;
  assert(pattern.test(value), 'Only literal loopback service URLs are allowed');
  const url = new URL(value);
  assert(Number(url.port) >= 1024 && Number(url.port) <= 65535, 'Unexpected local port');
  return url;
}

export function localStatus(status) {
  assert(status && typeof status === 'object', 'Local CLI status must be an object');
  const api = localURL(status.API_URL);
  const db = localURL(status.DB_URL, { database: true });
  assert.equal(api.origin, `http://127.0.0.1:${API_PORT}`, 'Wrong disposable API port');
  assert.equal(db.port, String(DB_PORT), 'Wrong disposable database port');
  for (const [key, value] of Object.entries(status)) {
    if (key.endsWith('_URL') && value) localURL(value, { database: /^(postgres|postgresql):/.test(value) });
  }
  for (const [key, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
    assert.equal(typeof status[key], 'string', `Missing local legacy ${key}`);
    const segments = status[key].split('.');
    assert.equal(segments.length, 3, `Expected local CLI JWT for ${key}`);
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString());
    assert.equal(payload.iss, 'supabase-demo', 'Non-local JWT issuer rejected');
    assert.equal(payload.role, role, 'Unexpected local API key role');
  }
  return { base: api.origin, anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY };
}

// Deliberate allowlist. No inherited Supabase/project/Vite/PG secrets, proxy routing,
// Docker contexts, NODE_OPTIONS, npm configuration, or developer-home credential files.
export function isolatedEnvironment(root, source = process.env) {
  return {
    PATH: source.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/home/.config`,
    XDG_CACHE_HOME: `${root}/home/.cache`, DOCKER_CONFIG: `${root}/home/.docker`,
    DOCKER_HOST: 'unix:///var/run/docker.sock',
    SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', CI: 'true',
    LANG: 'C.UTF-8', TZ: 'UTC',
  };
}

export function localFetch(base, path, init = {}) {
  const root = localURL(base);
  assert(path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'), 'Relative local API path required');
  const url = new URL(path, root);
  assert.equal(url.origin, root.origin, 'Cross-origin request rejected');
  assert(!url.hash, 'URL fragments are not API targets');
  localURL(url.origin);
  // node:http makes a direct socket connection. Unlike global fetch in Node 24,
  // it never picks up NODE_USE_ENV_PROXY or an inherited global dispatcher.
  return (async () => {
    const request = new Request(url, init);
    const body = request.body ? Buffer.from(await request.arrayBuffer()) : null;
    return new Promise((resolve, reject) => {
      const outgoing = directRequest(url, {
        method: request.method, headers: Object.fromEntries(request.headers), agent: directAgent,
        signal: init.signal || AbortSignal.timeout(45_000),
      }, incoming => {
        if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
          incoming.resume(); reject(Error('Service redirect rejected')); return;
        }
        const chunks = []; let size = 0;
        incoming.on('data', chunk => {
          size += chunk.length;
          if (size > 40 * 1024 * 1024) { incoming.destroy(Error('Local service response exceeds test limit')); return; }
          chunks.push(chunk);
        });
        incoming.on('error', reject);
        incoming.on('end', () => {
          const responseHeaders = new Headers();
          for (let i = 0; i < incoming.rawHeaders.length; i += 2) responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
          resolve(new Response([204, 205, 304].includes(incoming.statusCode) ? null : Buffer.concat(chunks), { status: incoming.statusCode, headers: responseHeaders }));
        });
      });
      outgoing.on('error', reject); outgoing.end(body);
    });
  })();
}

