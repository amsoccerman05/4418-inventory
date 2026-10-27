import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/hash-navigation.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {createHashNavigation} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

// A deterministic, in-memory History API; this tests route state logic, not browser layout/events.
function fixture(initial = 'dashboard', initialState = null) {
  const entries = [{url: new URL(`#${initial}`, 'http://inventory.test/'), state: initialState}];
  let position = 0;
  const listeners = new Map([['popstate', new Set()], ['hashchange', new Set()]]);
  const emit = type => { for (const listener of listeners.get(type)) listener({type, state: history.state}); };
  const tasks = [];
  const navigated = [];
  let dirty = false, busy = false, pending = null;
  const requested = [];
  const location = {
    get hash() { return entries[position].url.hash; },
    get href() { return entries[position].url.href; },
  };
  const history = {
    get state() { return entries[position].state; },
    replaceState(state, _title, url) { entries[position] = {state: structuredClone(state), url: new URL(url, location.href)}; },
    pushState(state, _title, url) {
      entries.splice(position + 1);
      entries.push({state: structuredClone(state), url: new URL(url, location.href)});
      position++;
    },
    go(delta) {
      const target = position + delta;
      if (target < 0 || target >= entries.length || delta === 0) return;
      tasks.push(() => { position = target; emit('popstate'); });
    },
  };
  const browser = {
    history, location,
    addEventListener(type, callback) { assert.ok(listeners.has(type)); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { assert.ok(listeners.has(type)); listeners.get(type).delete(callback); },
  };
  const guard = {
    get blocked() { return dirty || busy; },
    request(action) {
      if (busy) return;
      if (dirty) { pending = action; requested.push(action); }
      else action();
    },
  };
  const controller = createHashNavigation(browser, () => guard, route => navigated.push(route));
  const flushOne = () => { const task = tasks.shift(); if (task) task(); };
  const flush = () => {
    let limit = 30;
    while (tasks.length && limit--) flushOne();
    assert.equal(tasks.length, 0, 'history restoration must settle without an event loop');
  };
  return {
    browser, controller, entries, navigated, requested, flush, flushOne, emit,
    get position() { return position; },
    get hash() { return location.hash; },
    get pending() { return pending; },
    get listenerCount() { return listeners.get('popstate').size; },
    dirty(value = true) { dirty = value; }, busy(value = true) { busy = value; },
    keep() { pending = null; },
    discard() { assert.ok(pending, 'discard requires an explicit pending action'); const action = pending; pending = null; action(); flush(); },
    back(delta = 1) { history.go(-delta); flush(); },
    forward(delta = 1) { history.go(delta); flush(); },
    hashLink(path, eventType = 'popstate') {
      history.pushState(null, '', `#${path}`);
      tasks.push(() => { emit(eventType); });
      flush();
    },
  };
}

test('clean navigation preserves unrelated state and native Back/Forward entries', () => {
  const f = fixture('dashboard', {unrelated: 'retained'});
  f.controller.navigate('inventory');
  f.controller.navigate('locations');
  assert.equal(f.hash, '#locations');
  assert.deepEqual(f.entries.map(e => e.state.inventoryRouteIndex), [0, 1, 2]);
  assert.ok(f.entries.every(e => e.state.unrelated === 'retained'));
  f.back(); assert.equal(f.hash, '#inventory');
  f.back(); assert.equal(f.hash, '#dashboard');
  f.forward(2); assert.equal(f.hash, '#locations');
  assert.deepEqual(f.navigated, ['inventory', 'locations', 'inventory', 'dashboard', 'locations']);
});

test('canceled programmatic navigation runs neither route nor approval side effects', () => {
  const f = fixture('inventory');
  let resets = 0;
  f.dirty();
  f.controller.navigate('location/e-04', () => resets++);
  assert.equal(f.hash, '#inventory'); assert.equal(resets, 0);
  assert.deepEqual(f.navigated, []); assert.equal(f.entries.length, 1);
  f.keep();
  assert.equal(f.hash, '#inventory'); assert.equal(resets, 0);
  f.controller.navigate('location/e-04', () => resets++);
  f.discard();
  assert.equal(f.hash, '#location/e-04'); assert.equal(resets, 1);
  assert.deepEqual(f.navigated, ['location/e-04']);
});

test('Keep editing after Back restores the URL and preserves the real Forward stack', () => {
  const f = fixture('dashboard');
  f.controller.navigate('locations'); f.controller.navigate('inventory');
  const snapshot = () => f.entries.map(e => ({url: e.url.href, state: structuredClone(e.state)}));
  const original = snapshot();
  f.dirty();
  f.back();
  assert.equal(f.hash, '#inventory'); assert.equal(f.position, 2);
  assert.ok(f.pending); assert.deepEqual(snapshot(), original);
  assert.deepEqual(f.navigated, ['locations', 'inventory']);
  f.keep();
  f.back(); f.discard();
  assert.equal(f.hash, '#locations'); assert.equal(f.position, 1);
  assert.deepEqual(snapshot(), original);
  f.dirty(false); f.forward();
  assert.equal(f.hash, '#inventory');
});

test('Keep editing after Forward retains its starting route, then discard honors the destination', () => {
  const f = fixture();
  f.controller.navigate('inventory'); f.controller.navigate('locations');
  f.back();
  f.dirty(); f.forward();
  assert.equal(f.hash, '#inventory'); assert.ok(f.pending);
  f.keep(); assert.equal(f.hash, '#inventory');
  f.forward(); f.discard();
  assert.equal(f.hash, '#locations');
});

test('multi-entry history jumps restore and replay exactly the requested delta', () => {
  const f = fixture();
  f.controller.navigate('inventory'); f.controller.navigate('locations'); f.controller.navigate('restock');
  f.dirty(); f.back(3);
  assert.equal(f.hash, '#restock'); assert.equal(f.position, 3);
  f.discard(); assert.equal(f.hash, '#dashboard'); assert.equal(f.position, 0);
  f.forward(3); assert.equal(f.hash, '#dashboard');
  f.discard(); assert.equal(f.hash, '#restock'); assert.equal(f.position, 3);
});

test('a plain hash link is tagged, canceled safely, and accepted without losing its Back entry', () => {
  const f = fixture('inventory');
  f.dirty(); f.hashLink('restock');
  assert.equal(f.hash, '#inventory'); assert.equal(f.position, 0);
  assert.deepEqual(f.entries.map(e => e.state.inventoryRouteIndex), [0, 1]);
  assert.deepEqual(f.navigated, []);
  f.keep();
  f.forward(); f.discard();
  assert.equal(f.hash, '#restock');
  f.dirty(false); f.back(); assert.equal(f.hash, '#inventory');
});

test('newer navigation replaces a pending destination and side effects execute only once', () => {
  const f = fixture('inventory');
  const resets = [];
  f.dirty();
  f.controller.navigate('restock', () => resets.push('old'));
  f.controller.navigate('location/e-04', () => resets.push('new'));
  assert.equal(f.requested.length, 2);
  f.discard();
  assert.equal(f.hash, '#location/e-04');
  assert.deepEqual(resets, ['new']);
  assert.equal(f.entries.length, 2);
});

test('repeat Back attempts do not lose history or silently accept a dirty form', () => {
  const f = fixture();
  f.controller.navigate('locations'); f.controller.navigate('inventory');
  f.dirty();
  for (let n = 0; n < 4; n++) {
    f.back(); assert.equal(f.hash, '#inventory');
    assert.equal(f.entries.length, 3); assert.equal(f.position, 2);
    assert.ok(f.pending); f.keep();
  }
  assert.deepEqual(f.navigated, ['locations', 'inventory']);
  f.back(); f.discard(); assert.equal(f.hash, '#locations');
});

test('busy forms reject programmatic and browser navigation without submitting any action', () => {
  const f = fixture('locations');
  f.controller.navigate('inventory');
  let submitted = 0;
  f.busy();
  f.controller.navigate('restock', () => submitted++);
  assert.equal(f.hash, '#inventory'); assert.equal(submitted, 0); assert.equal(f.pending, null);
  f.back(); assert.equal(f.hash, '#inventory'); assert.equal(f.pending, null);
  f.busy(false); f.back(); assert.equal(f.hash, '#locations');
  assert.deepEqual(f.navigated, ['inventory', 'locations']);
});

test('same-route navigation does not create duplicate history but remains guarded', () => {
  const f = fixture('inventory');
  f.dirty(); f.controller.navigate('inventory');
  assert.ok(f.pending); assert.equal(f.entries.length, 1); assert.deepEqual(f.navigated, []);
  f.discard();
  assert.equal(f.entries.length, 1); assert.deepEqual(f.navigated, ['inventory']);
});

test('a new navigation after going Back truncates only native future entries', () => {
  const f = fixture();
  f.controller.navigate('inventory'); f.controller.navigate('locations');
  f.back(); f.controller.navigate('restock');
  assert.deepEqual(f.entries.map(e => e.url.hash), ['#dashboard', '#inventory', '#restock']);
  assert.deepEqual(f.entries.map(e => e.state.inventoryRouteIndex), [0, 1, 2]);
  f.forward(); assert.equal(f.hash, '#restock');
});

test('dispose removes its popstate listener and remount preserves the accepted history index', () => {
  const f = fixture('inventory', {inventoryRouteIndex: 9, unrelated: true});
  f.controller.navigate('restock');
  assert.equal(f.browser.history.state.inventoryRouteIndex, 10);
  assert.equal(f.listenerCount, 1);
  f.controller.dispose(); assert.equal(f.listenerCount, 0);
  const remounted = createHashNavigation(f.browser, () => null, route => f.navigated.push(`remount:${route}`));
  assert.equal(f.listenerCount, 1);
  f.back(); assert.equal(f.hash, '#inventory');
  assert.equal(f.browser.history.state.inventoryRouteIndex, 9);
  assert.equal(f.navigated.at(-1), 'remount:inventory');
  remounted.dispose(); assert.equal(f.listenerCount, 0);
});

test('newer app navigation wins when requested while a Back restoration is in flight', () => {
  const f = fixture();
  f.controller.navigate('inventory'); f.controller.navigate('restock');
  f.dirty();
  f.browser.history.go(-1);
  f.flushOne(); // Back arrived, its automatic restoration has not arrived yet.
  assert.equal(f.hash, '#inventory');
  f.controller.navigate('locations');
  f.flush();
  assert.equal(f.hash, '#restock');
  f.discard();
  assert.equal(f.hash, '#locations');
  assert.deepEqual(f.navigated, ['inventory', 'restock', 'locations']);
});

test('a no-op popstate must not notify navigation or close an unfinished editor', () => {
  const f = fixture('inventory');
  f.dirty();
  f.emit('popstate');
  assert.equal(f.hash, '#inventory');
  assert.deepEqual(f.navigated, []);
  assert.equal(f.pending, null);
});

test('a duplicate popstate after Keep editing must not bypass the dirty guard', () => {
  const f = fixture('locations');
  f.controller.navigate('inventory');
  f.dirty(); f.back(); f.keep();
  f.emit('popstate');
  assert.equal(f.hash, '#inventory');
  assert.deepEqual(f.navigated, ['inventory']);
  assert.equal(f.pending, null);
});

test('clean fragment-only navigation updates the accepted route even without popstate', () => {
  const f = fixture('dashboard');
  f.hashLink('location/drawer', 'hashchange');
  assert.equal(f.hash, '#location/drawer');
  assert.deepEqual(f.navigated, ['location/drawer']);
});

test('duplicate popstate and hashchange events notify an accepted route only once', () => {
  const f = fixture('dashboard');
  f.hashLink('admin');
  f.emit('hashchange'); f.emit('popstate');
  assert.deepEqual(f.navigated, ['admin']);
});

test('dirty fragment-only navigation restores the editor before asking for discard', () => {
  const f = fixture('inventory');
  f.dirty(); f.hashLink('restock', 'hashchange');
  assert.equal(f.hash, '#inventory');
  assert.deepEqual(f.navigated, []);
  assert.ok(f.pending);
  f.keep(); f.emit('hashchange');
  assert.deepEqual(f.navigated, []);
});
