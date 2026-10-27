import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/navigation-context.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {createNavigationContextStore, navigationStorageKey, emptyListContext} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function fixture(raw) {
  const values = new Map(raw ? [[navigationStorageKey, raw]] : []);
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
  return {values, storage, store: createNavigationContextStore(() => storage)};
}

test('same-account reload retains search, all filters, position and per-location context', () => {
  const f = fixture(); f.store.activate('student');
  const filters = {...emptyListContext, search: 'wrench', area: 'fabrication', category: 'Tools', loc: 'drawer', stock: 'MISSING', itemType: 'Tool', ownership: 'Shared / School', filtersOpen: true, scrollY: 1427, visited: true};
  f.store.update('student', 'inventory', filters);
  f.store.update('student', 'location/drawer', {search: 'hex', audit: false, scrollY: 481});
  const restored = createNavigationContextStore(() => f.storage); restored.activate('student');
  assert.deepEqual(restored.read('student', 'inventory'), filters);
  assert.equal(restored.read('student', 'location/drawer').search, 'hex');
  assert.equal(restored.read('student', 'location/drawer').audit, false);
  assert.equal(restored.read('student', 'location/drawer').scrollY, 481);
  assert.equal(restored.read('student', 'location/other'), undefined);
});

test('signout deletes saved state and rejects late scroll or filter writes from the old account', () => {
  const f = fixture(); f.store.activate('student'); f.store.update('student', 'inventory', {search: 'old search'});
  f.store.activate(null);
  f.store.update('student', 'inventory', {search: 'late old search'});
  assert.equal(f.values.has(navigationStorageKey), false);
  assert.equal(f.store.read('student', 'inventory'), undefined);
  f.store.activate('student');
  assert.equal(f.store.read('student', 'inventory'), undefined);
});

test('switching accounts clears all prior views and returning to that account does not resurrect them', () => {
  const f = fixture(); f.store.activate('mentor'); f.store.update('mentor', 'inventory', {search: 'mentor search'});
  f.store.update('mentor', 'location/drawer', {area: 'old area'});
  f.store.activate('student');
  f.store.update('mentor', 'inventory', {search: 'late'});
  assert.equal(f.store.read('student', 'inventory'), undefined);
  assert.equal(f.store.read('mentor', 'inventory'), undefined);
  f.store.update('student', 'inventory', {search: 'student search'});
  f.store.activate('mentor');
  assert.equal(f.store.read('mentor', 'inventory'), undefined);
  assert.ok(!JSON.stringify([...f.values]).includes('student search'));
});

test('only allowlisted navigation values are serialized, not drafts, tokens, record fields or routes', () => {
  const f = fixture(); f.store.activate('student');
  f.store.update('student', 'inventory', {search: 'part', scrollY: -4, draft: {name: 'SENSITIVE'}, quantity: 99, access_token: 'SECRET'});
  for (const route of ['__proto__', 'item/123', 'location/../admin', 'https://external.test', 'access_token=SECRET']) f.store.update('student', route, {search: 'ignored'});
  const saved = f.values.get(navigationStorageKey);
  for (const forbidden of ['SENSITIVE', 'SECRET', 'quantity', 'ignored', 'draft']) assert.ok(!saved.includes(forbidden));
  assert.deepEqual(Object.keys(JSON.parse(saved).views), ['inventory']);
  assert.equal(f.store.read('student', 'inventory').scrollY, 0);
});

test('malformed or stale snapshots fail closed, and restored values are bounded and sanitized', () => {
  for (const raw of ['invalid json', '{}', JSON.stringify({version: 9, userId: 'student', views: {inventory: {search: 'old'}}}), JSON.stringify({version: 1, userId: 'other', views: {inventory: {search: 'other'}}})]) {
    const f = fixture(raw); f.store.activate('student'); assert.equal(f.store.read('student', 'inventory'), undefined);
  }
  const f = fixture(JSON.stringify({version: 1, userId: 'student', views: {inventory: {search: 'x'.repeat(999), area: 5, scrollY: 99_999_999, filtersOpen: 'yes', audit: false, notes: 'PRIVATE'}}}));
  f.store.activate('student');
  const view = f.store.read('student', 'inventory');
  assert.equal(view.search.length, 500); assert.equal(view.area, ''); assert.equal(view.scrollY, 10_000_000); assert.equal(view.filtersOpen, false); assert.equal(view.audit, false);
  assert.ok(!f.values.get(navigationStorageKey).includes('PRIVATE'));
});

test('storage restrictions fall back to in-memory context and identity isolation', () => {
  const store = createNavigationContextStore(() => {throw new Error('Storage disabled');});
  store.activate('student'); store.update('student', 'inventory', {search: 'retained while open'});
  assert.equal(store.read('student', 'inventory').search, 'retained while open');
  store.activate('student'); assert.equal(store.read('student', 'inventory').search, 'retained while open');
  store.activate(null); assert.equal(store.read('student', 'inventory'), undefined);
});

test('bounded location cache evicts oldest views and reads cannot mutate stored state', () => {
  const f = fixture(); f.store.activate('student');
  for (let i = 0; i < 110; i++) f.store.update('student', `location/${i}`, {search: String(i)});
  assert.equal(Object.keys(JSON.parse(f.values.get(navigationStorageKey)).views).length, 100);
  assert.equal(f.store.read('student', 'location/0'), undefined);
  const view = f.store.read('student', 'location/109'); view.search = 'changed';
  assert.equal(f.store.read('student', 'location/109').search, '109');
});

test('readable stale storage cannot resurrect old context when removal or writes fail', () => {
  const raw = JSON.stringify({version: 1, userId: 'student', views: {inventory: {search: 'stale secret query'}}});
  const storage = {getItem: () => raw, setItem: () => {throw new Error('Quota');}, removeItem: () => {throw new Error('Storage blocked');}};
  const store = createNavigationContextStore(() => storage);
  store.activate('student'); assert.equal(store.read('student', 'inventory').search, 'stale secret query');
  store.activate(null); store.activate('student');
  assert.equal(store.read('student', 'inventory'), undefined);
  store.activate('other'); store.activate('student');
  assert.equal(store.read('student', 'inventory'), undefined);
});
