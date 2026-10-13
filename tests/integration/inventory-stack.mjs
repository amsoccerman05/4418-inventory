// Real Auth sessions and real HTTP PostgREST on an owned disposable stack only.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { localFetch, localURL, API_PORT, ORIGIN } from './inventory-safety.mjs';

const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const area = '44180000-0000-4000-8000-000000000001';
const otherArea = '44180000-0000-4000-8000-000000000002';
export async function runInventoryIntegration({ base, anonKey, sql, registerSecret }) {
  assert.equal(localURL(base).origin, `http://127.0.0.1:${API_PORT}`, 'Only the owned disposable stack is supported');
  assert.equal(sql('select count(*) from public.inventory_items'), '0', 'Refusing nonempty inventory');
  const checks = [];
  const pass = label => { checks.push(label); console.log(`PASS Inventory: ${label}`); };
  const headers = actor => ({ apikey: anonKey, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), Origin: ORIGIN });
  const request = (path, body, actor = null, method = 'POST') => localFetch(base, path, {
    method, headers: { ...headers(actor), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  const rpc = (name, body, actor) => request(`/rest/v1/rpc/${name}`, body, actor);
  const get = (path, actor) => localFetch(base, `/rest/v1/${path}`, { headers: headers(actor) });
  async function json(response, status = 200) {
    const body = await response.json();
    assert.equal(response.status, status, `HTTP ${response.status}; code=${body?.code || body?.error_code || 'unspecified'}; message=${body?.message || 'unspecified'}`);
    return body;
  }
  async function denied(response, pattern, codes = ['42501']) {
    const body = await response.json();
    assert(!response.ok, `Expected denial; HTTP ${response.status}`);
    assert(codes.includes(body.code), `Unexpected denial code ${body.code}: ${body.message}`);
    assert.match(body.message, pattern);
    return body;
  }
  const users = {};
  for (const [name, role, active, assignedArea] of [
    ['mentor', 'mentor', true, null], ['admin', 'admin', true, null],
    ['student', 'student', true, null], ['lead', 'lead', true, area],
    ['otherLead', 'lead', true, otherArea], ['reader', 'readonly', true, null],
    ['inactive', 'mentor', false, null], ['unprofiled', null, true, null],
  ]) {
    const email = `inventory-${name.toLowerCase()}-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomBytes(24).toString('hex')}!`;
    registerSecret(password);
    const signup = await json(await request('/auth/v1/signup', { email, password, data: { display_name: `Synthetic ${name}`, role: 'admin', primary_area_id: area } }));
    assert(signup.user?.id && signup.access_token, 'Local real Auth signup must provide an authenticated session');
    registerSecret(signup.access_token); if (signup.refresh_token) registerSecret(signup.refresh_token);
    assert.equal(sql(`select role from public.profiles where id=${lit(signup.user.id)}`), 'readonly', 'User metadata must not grant privileges');
    const login = await json(await request('/auth/v1/token?grant_type=password', { email, password }));
    assert.equal(login.user.id, signup.user.id);
    registerSecret(login.access_token); if (login.refresh_token) registerSecret(login.refresh_token);
    const actor = { id: login.user.id, token: login.access_token };
    const actual = await json(await localFetch(base, '/auth/v1/user', { headers: headers(actor) }));
    assert.equal(actual.id, actor.id); assert.equal(actual.user_metadata.role, 'admin');
    if (role) sql(`update public.profiles set role=${lit(role)},active=${active},primary_area_id=${assignedArea ? lit(assignedArea) : 'null'} where id=${lit(actor.id)};`);
    else sql(`delete from public.profiles where id=${lit(actor.id)};`);
    users[name] = actor;
  }
  const { mentor, admin, student, lead, otherLead, reader, inactive, unprofiled } = users;
  const deadline = Date.now() + 15_000;
  while (true) {
    const response = await rpc('inventory_setup_features', {}, reader);
    const body = await response.json();
    if (body.code !== 'PGRST202') { assert.equal(response.status, 200); assert.equal(body, 1); break; }
    assert(Date.now() < deadline, 'Setup RPC did not reach PostgREST schema cache');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const [home] = await json(await request('/rest/v1/locations', { name: 'Synthetic setup drawer', code: 'SYN-01', location_type: 'Drawer' }, mentor), 201);
  const [parent] = await json(await request('/rest/v1/locations', { name: 'Synthetic setup cabinet', code: 'SYN-CAB', location_type: 'Storage' }, mentor), 201);
  assert.match(home.label_code, /^L-[0-9A-F]{12}$/); assert.notEqual(home.label_code, parent.label_code);
  const newItem = async (overrides = {}) => (await json(await request('/rest/v1/inventory_items', {
    name: 'Synthetic inventory setup item', area_id: area, category: 'Synthetic hardware', location_id: home.id,
    quantity: 7.5, expected_quantity: 9, minimum_quantity: 0, target_quantity: 0, ...overrides,
  }, mentor), 201))[0];
  let item = await newItem();
  const setupPayload = (row, extra = {}) => ({ p_id: row.id, p_expected_updated_at: row.updated_at, p_policy: 'restock', p_minimum: 2, p_target: 6, ...extra });
  const setup = (row, actor, extra = {}) => rpc('setup_inventory_item', setupPayload(row, extra), actor);
  const readItem = async id => (await json(await get(`inventory_items?id=eq.${id}&select=*`, mentor)))[0];
  const fingerprint = () => createHash('sha256').update(sql(`select jsonb_build_object(${[
    'inventory_items', 'inventory_balances', 'inventory_events', 'inventory_movements', 'locations', 'trips', 'trip_manifest_items',
  ].map(table => `${lit(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${table} t)`).join(',')})`)).digest('hex');
  const audits = id => Number(sql(`select count(*) from public.inventory_events where inventory_item_id=${lit(id)}`));
  const balances = id => sql(`select jsonb_agg(to_jsonb(t) order by id) from public.inventory_balances t where inventory_item_id=${lit(id)}`);

  const beforeDenied = fingerprint();
  for (const actor of [student, otherLead, reader, inactive, unprofiled]) {
    await denied(await setup(item, actor), /assigned lead|active profile|unavailable|permission/, ['42501', '40001']);
  }
  await denied(await setup(item, null), /permission denied/);
  await denied(await rpc('inventory_setup_features', {}, null), /permission denied/);
  for (const actor of [inactive, unprofiled]) {
    await denied(await rpc('inventory_setup_features', {}, actor), /active profile/);
    assert.deepEqual(await json(await get(`locations?label_code=eq.${home.label_code}`, actor)), []);
  }
  assert.equal(fingerprint(), beforeDenied);
  pass('eight real Auth sessions; forged admin metadata, anonymous, inactive, unprofiled, readonly, student and out-of-area callers cannot set up inventory');

  for (const actor of [lead, admin, mentor]) {
    const row = await newItem(); const balanceBefore = balances(row.id);
    const saved = (await json(await setup(row, actor))).item;
    assert.equal(saved.restock_policy, 'restock'); assert.equal(saved.minimum_quantity, 2); assert.equal(saved.target_quantity, 6);
    assert.equal(saved.updated_by, actor.id);
    const metadata = new Set(['restock_policy', 'minimum_quantity', 'target_quantity', 'updated_by', 'updated_at']);
    const stable = value => Object.fromEntries(Object.entries(value).filter(([key]) => !metadata.has(key)));
    assert.deepEqual(stable(saved), stable(row)); assert.equal(balances(row.id), balanceBefore);
    assert.equal(audits(row.id), 2);
    assert.equal(sql(`select user_id from public.inventory_events where inventory_item_id=${lit(row.id)} and event_type='item_updated'`), actor.id);
    const noRestock = (await json(await setup(saved, actor, { p_policy: 'do_not_restock', p_minimum: 0, p_target: 0 }))).item;
    assert.equal(noRestock.restock_policy, 'do_not_restock'); assert.equal(noRestock.quantity, 7.5); assert.equal(noRestock.last_verified_at, null);
  }
  pass('assigned lead, admin and mentor metadata saves preserve counts, expected amounts, verification and balance bytes and record the authenticated actor');

  for (const patch of [
    { p_policy: 'invalid' }, { p_policy: null }, { p_minimum: -1 }, { p_target: -1 },
    { p_minimum: null }, { p_target: null }, { p_target: 2 }, { p_target: 1 },
    { p_minimum: 'NaN' }, { p_target: 'Infinity' },
  ]) {
    const before = fingerprint();
    await denied(await setup(item, mentor, patch), /policy|finite|greater|constraint/, ['23514']);
    assert.equal(fingerprint(), before);
  }
  const beforeStudent = fingerprint();
  for (const actor of [student, otherLead]) {
    await denied(await request(`/rest/v1/inventory_items?id=eq.${item.id}`, { restock_policy: 'do_not_restock' }, actor, 'PATCH'), /metadata/);
  }
  assert.deepEqual(await json(await request(`/rest/v1/inventory_items?id=eq.${item.id}`, { restock_policy: 'do_not_restock' }, reader, 'PATCH')), []);
  assert.equal(fingerprint(), beforeStudent);
  pass('table-boundary validation rejects null, invalid, negative, NaN/infinite, and target-at-or-below-minimum values; direct REST cannot bypass metadata permissions');

  await json(await rpc('change_inventory_quantity', { p_id: item.id, p_delta: 1, p_verify: true }, student));
  const counted = await readItem(item.id); const beforeStale = fingerprint();
  assert.equal(counted.quantity, 8.5); assert.equal(counted.last_verified_by, student.id); assert.equal(counted.restock_policy, 'unset');
  await denied(await setup(item, mentor), /changed/, ['40001']);
  await denied(await setup(counted, mentor, { p_expected_updated_at: null }), /changed/, ['40001']);
  await denied(await setup(counted, mentor, { p_id: randomUUID() }), /unavailable/, ['40001']);
  assert.equal(fingerprint(), beforeStale);
  item = (await json(await setup(counted, mentor))).item;
  const persisted = { ...item };
  const legacyPatch = await rpc('apply_inventory_changes', { p_changes: { items: [{ expected_updated_at: item.updated_at, record: { id: item.id, notes: 'Synthetic legacy patch omitting policy' } }] } }, mentor);
  assert(legacyPatch.ok, `Legacy patch HTTP ${legacyPatch.status}: ${await legacyPatch.text()}`);
  item = await readItem(item.id); assert.equal(item.restock_policy, 'restock'); assert.equal(item.last_verified_at, persisted.last_verified_at);
  pass('student counting still works; setup rejects stale/missing versions atomically; legacy patches preserve the explicit restock policy');

  const beforeRead = fingerprint();
  for (const actor of [reader, student, lead, mentor]) {
    const found = await json(await get(`locations?label_code=eq.${home.label_code}&select=id,label_code,name`, actor));
    assert.equal(found.length, 1); assert.equal(found[0].id, home.id);
  }
  const anonRead = await get(`locations?label_code=eq.${home.label_code}`, null);
  await denied(anonRead, /permission denied/);
  assert.deepEqual(await json(await get('locations?label_code=eq.L-000000000000', student)), []);
  assert.equal(fingerprint(), beforeRead, 'Label lookup must remain read-only');
  for (const actor of [mentor, admin]) {
    await denied(await request(`/rest/v1/locations?id=eq.${home.id}`, { label_code: 'L-ABCDEF123456' }, actor, 'PATCH'), /immutable/);
  }
  await json(await request(`/rest/v1/locations?id=eq.${home.id}`, { name: 'Synthetic renamed drawer', parent_id: parent.id }, mentor, 'PATCH'));
  const [renamed] = await json(await get(`locations?id=eq.${home.id}`, mentor));
  assert.equal(renamed.label_code, home.label_code); assert.equal(renamed.parent_id, parent.id);
  await denied(await request('/rest/v1/locations', { name: 'Duplicate synthetic label', label_code: home.label_code }, mentor), /unique|duplicate/, ['23505']);
  await denied(await localFetch(base, '/rest/v1/inventory_schema_versions?select=*', { headers: { ...headers(mentor), 'Accept-Profile': 'private' } }), /schema/i, ['PGRST106']);
  pass('authenticated label lookups are read-only; unknown labels return none; rename/reparent preserves identity; direct immutable/duplicate label writes and private-schema requests fail');

  const concurrentItem = await newItem(); const auditsBefore = audits(concurrentItem.id);
  const results = await Promise.all([
    setup(concurrentItem, mentor, { p_minimum: 1, p_target: 4 }),
    setup(concurrentItem, lead, { p_minimum: 3, p_target: 9 }),
  ]);
  assert.equal(results.filter(response => response.ok).length, 1);
  await json(results.find(response => response.ok));
  await denied(results.find(response => !response.ok), /changed/, ['40001']);
  assert.equal(audits(concurrentItem.id), auditsBefore + 1);
  assert.equal((await readItem(concurrentItem.id)).quantity, 7.5);
  pass('parallel HTTP setup saves with one original version commit exactly one change and one event');

  const failureItem = await newItem(); const beforeFailure = fingerprint();
  sql(`create function private.synthetic_setup_audit_failure() returns trigger language plpgsql as $$begin
    if new.inventory_item_id=${lit(failureItem.id)} then raise exception 'Synthetic setup audit failure';end if;return new;end$$;
    create trigger synthetic_setup_audit_failure before insert on public.inventory_events for each row execute function private.synthetic_setup_audit_failure();`);
  try {
    await denied(await setup(failureItem, mentor), /Synthetic setup audit failure/, ['P0001']);
    assert.equal(fingerprint(), beforeFailure, 'Failed event insert must roll back metadata, version and balances');
  } finally { sql('drop trigger synthetic_setup_audit_failure on public.inventory_events;drop function private.synthetic_setup_audit_failure();'); }
  await json(await setup(failureItem, mentor)); assert.equal(audits(failureItem.id), 2);
  sql(`update public.profiles set active=false where id=${lit(lead.id)}`);
  // Check revocation with the same Auth token against an existing row.
  const beforeRevokedRequest = fingerprint();
  await denied(await setup(await readItem(item.id), lead), /active profile/);
  assert.equal(fingerprint(), beforeRevokedRequest);
  pass('audit insertion failure is fully atomic and retryable; profile revocation blocks an already issued real Auth session');
  return checks;
}
