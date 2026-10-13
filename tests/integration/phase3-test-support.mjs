// Common test plumbing for later stages. No phase 4/5 schema dependency.
// Called only by the owner of a fresh, verified disposable local stack.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { localFetch, localURL, API_PORT, ORIGIN } from './inventory-safety.mjs';

export const lit = value => `'${String(value).replaceAll("'", "''")}'`;
export const area = '44180000-0000-4000-8000-000000000001';
export const otherArea = '44180000-0000-4000-8000-000000000002';
export function phaseAPI({ base, anonKey, sql, registerSecret }, phase) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable stack is supported');
  assert.equal(typeof registerSecret, 'function', 'The owner must redact real Auth credentials');
  const checks = [];
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const request = (path, body, actor = null, method = 'POST') => localFetch(base, path, {
    method, headers: { ...headers(actor), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  const get = (path, actor) => request(`/rest/v1/${path}`, undefined, actor, 'GET');
  async function json(response, status = 200) {
    const body = await response.json();
    assert.equal(response.status, status, `HTTP ${response.status}; code=${body?.code || body?.error_code || 'unspecified'}; message=${body?.message || 'unspecified'}`);
    return body;
  }
  async function denied(response, pattern, codes = ['42501', 'P0001', '40001']) {
    const body = await response.json();
    assert(!response.ok, `Expected denial; HTTP ${response.status}`);
    assert(codes.includes(body.code), `Unexpected denial ${body.code}: ${body.message}`);
    assert.match(body.message, pattern);
    return body;
  }
  async function session(name, role, active = true, assignedArea = null) {
    const email = `inventory-${phase}-${name.toLowerCase()}-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    const signup = await json(await request('/auth/v1/signup', { email, password, data: { display_name: `Synthetic ${phase} ${name}`, role: 'admin', primary_area_id: area } }));
    assert(signup.user?.id && signup.access_token, 'Real Auth signup must supply a session');
    registerSecret(signup.access_token); if (signup.refresh_token) registerSecret(signup.refresh_token);
    assert.equal(sql(`select role from public.profiles where id=${lit(signup.user.id)}`), 'readonly', 'Signup metadata must never grant roles');
    const login = await json(await request('/auth/v1/token?grant_type=password', { email, password }));
    assert.equal(login.user.id, signup.user.id);
    registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    const actor = { id: login.user.id, token: login.access_token };
    assert.equal((await json(await localFetch(base, '/auth/v1/user', { headers: headers(actor) }))).id, actor.id);
    // Only synthetic local profiles are assigned test roles. No production role export.
    if (role) sql(`update public.profiles set role=${lit(role)},active=${active},primary_area_id=${assignedArea ? lit(assignedArea) : 'null'} where id=${lit(actor.id)}`);
    else sql(`delete from public.profiles where id=${lit(actor.id)}`);
    return actor;
  }
  async function schemaReady(name, body, actor) {
    const end = Date.now() + 15_000;
    while (true) {
      const response = await rpc(name, body, actor); const result = await response.json();
      if (result.code !== 'PGRST202') { assert.equal(response.status, 200, JSON.stringify(result)); return result; }
      assert(Date.now() < end, `${name} did not reach the PostgREST schema cache`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  const fingerprint = tables => createHash('sha256').update(sql(`select jsonb_build_object(${tables.map(table => {
    assert(/^[a-z_]+\.[a-z_]+$/.test(table), 'Only explicit test table names are supported');
    return `${lit(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t)`;
  }).join(',')})`)).digest('hex');
  const read = (table, id) => { assert(/^[a-z_]+\.[a-z_]+$/.test(table)); return JSON.parse(sql(`select to_jsonb(t) from ${table} t where id=${lit(id)}`)); };
  const pass = label => { checks.push(label); console.log(`PASS Inventory phase ${phase}: ${label}`); };
  return { checks, headers, request, rpc, get, json, denied, session, schemaReady, fingerprint, read, pass };
}
