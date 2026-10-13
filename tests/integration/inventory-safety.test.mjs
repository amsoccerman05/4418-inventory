import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { localURL, localStatus, localFetch, isolatedEnvironment, API_PORT, DB_PORT, ORIGIN } from './inventory-safety.mjs';
const key = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role })).toString('base64url')}.synthetic`;
const status = () => ({ API_URL: `http://127.0.0.1:${API_PORT}`, DB_URL: `postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`, ANON_KEY: key('anon'), SERVICE_ROLE_KEY: key('service_role') });

test('only literal loopback URLs are accepted', () => {
  for (const value of ['http://127.0.0.1:54331', 'http://localhost:54331/', 'http://[::1]:54331']) assert(localURL(value));
  for (const value of ['https://example.supabase.co', 'http://10.0.0.1:54331', 'http://127.1:54331', 'http://2130706433:54331', 'http://0177.0.0.1:54331', 'http://localhost.evil.test:54331', 'http://u:p@127.0.0.1:54331', 'http://127.0.0.1:54331/?next=remote', 'http://127.0.0.1:54331/#x', 'http://127.0.0.1:80', 'file:///tmp/secret', 'http://127.0.0.1:54331\\@evil.test']) assert.throws(() => localURL(value), value);
});
test('CLI status enforces local ports and synthetic CLI key issuer/role', () => {
  assert.equal(localStatus(status()).base, `http://127.0.0.1:${API_PORT}`);
  for (const patch of [{ API_URL: 'https://remote.supabase.co' }, { DB_URL: 'postgresql://postgres:postgres@remote:54332/postgres' }, { API_URL: 'http://127.0.0.1:54321' }, { SERVICE_ROLE_KEY: key('anon') }, { STORAGE_URL: 'http://remote:54331' }, { ANON_KEY: 'secret' }]) assert.throws(() => localStatus({ ...status(), ...patch }));
});
test('subprocess environment does not inherit account credentials or remote routing', () => {
  const env = isolatedEnvironment('/tmp/synthetic', { PATH: '/usr/bin', SUPABASE_ACCESS_TOKEN: 'secret', VITE_SUPABASE_URL: 'https://remote', PGPASSWORD: 'secret', HTTPS_PROXY: 'https://remote', DOCKER_HOST: 'tcp://remote:2375', NODE_OPTIONS: '--require bad', HOME: '/real-home' });
  for (const name of ['SUPABASE_ACCESS_TOKEN', 'VITE_SUPABASE_URL', 'PGPASSWORD', 'HTTPS_PROXY', 'NODE_OPTIONS']) assert(!(name in env));
  assert.equal(env.HOME, '/tmp/synthetic/home');
  assert.equal(env.DOCKER_HOST, 'unix:///var/run/docker.sock');
});
test('HTTP wrapper refuses path escape and redirects before following them', async () => {
  const server = createServer((req, res) => { res.writeHead(302, { Location: 'https://example.invalid/never-follow' }); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['//example.invalid', 'https://example.invalid', '/\\example.invalid']) assert.throws(() => localFetch(base, path));
    await assert.rejects(localFetch(base, '/redirect'), /redirect rejected/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('parent Node proxy environment cannot redirect loopback API traffic', async () => {
  let proxyHits = 0;
  const server = createServer((req, res) => { res.end('synthetic-direct-ok'); });
  const proxy = createServer((req, res) => { proxyHits++; res.writeHead(502); res.end(); });
  proxy.on('connect', (req, socket) => { proxyHits++; socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  await Promise.all([server, proxy].map(s => new Promise(resolve => s.listen(0, '127.0.0.1', resolve))));
  const proxyURL = `http://127.0.0.1:${proxy.address().port}`;
  try {
    const code = `import {localFetch} from ${JSON.stringify(new URL('./inventory-safety.mjs', import.meta.url).href)};const r=await localFetch('http://127.0.0.1:${server.address().port}','/direct');if(await r.text()!=='synthetic-direct-ok')process.exit(2);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { PATH: process.env.PATH, NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxyURL, HTTPS_PROXY: proxyURL, ALL_PROXY: proxyURL, NO_PROXY: '' }, stdio: 'pipe' });
    let errors = ''; child.stderr.on('data', b => { errors += b; });
    const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.equal(exit, 0, errors); assert.equal(proxyHits, 0);
  } finally { await Promise.all([server, proxy].map(s => new Promise(resolve => s.close(resolve)))); }
});

