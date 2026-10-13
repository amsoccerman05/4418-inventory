// Real Auth/PostgREST phase 3 extension. Runs independently of phases 4 and 5.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { phaseAPI, lit, area, otherArea } from './phase3-test-support.mjs';
import { localFetch } from './inventory-safety.mjs';

export async function runPhase3Integration(context) {
  const { sql, base } = context;
  const { checks, headers, request, rpc, get, json, denied, session, schemaReady, fingerprint, read, pass } = phaseAPI(context, '3');
  assert.equal(sql('select count(*) from inventory_purchasing.requests'), '0', 'Phase 3 must start with no restock requests');
  assert.equal(sql('select count(*) from public.finance_purchase_orders'), '0', 'Never test against existing POs');
  const authDefinition = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
  assert(!authDefinition.includes('test.uid'), 'A mocked identity function cannot prove real Auth');
  const mentor = await session('mentor', 'mentor');
  const student = await session('requester', 'student');
  const counter = await session('counter', 'student');
  const lead = await session('lead', 'lead', true, area);
  const otherLead = await session('otherlead', 'lead', true, otherArea);
  const finance = await session('finance', 'lead', true, area);
  const coach = await session('coach', 'mentor');
  const reader = await session('reader', 'readonly');
  const inactive = await session('inactive', 'student', false);
  const unprofiled = await session('unprofiled', null);
  sql(`insert into public.team_positions(key,name) values('finance_lead','Synthetic Finance'),('lead_coach_1','Synthetic Coach');
    insert into public.team_member_positions(user_id,position_key) values(${lit(finance.id)},'finance_lead'),(${lit(coach.id)},'lead_coach_1');`);
  await schemaReady('inventory_purchasing_context', { p_item_id: null }, reader);
  const [home] = await json(await request('/rest/v1/locations', { name: 'Synthetic restock home', location_type: 'Drawer' }, mentor), 201);
  const [project] = await json(await request('/rest/v1/locations', { name: 'Synthetic restock receiving', location_type: 'Storage' }, mentor), 201);
  const tables = ['public.inventory_items', 'public.inventory_balances', 'public.inventory_events', 'public.inventory_movements',
    'inventory_purchasing.settings', 'inventory_purchasing.requests', 'inventory_purchasing.receipts', 'inventory_purchasing.history',
    'public.finance_purchase_orders', 'public.finance_po_revisions', 'public.finance_po_approvals', 'finance_private.history', 'public.team_notifications'];
  const state = () => fingerprint(tables);
  const act = (action, data, actor = student) => rpc('inventory_purchasing_action', { p_action: action, p_data: data }, actor);
  const inspect = async (item, actor = counter) => json(await rpc('inventory_purchasing_context', { p_item_id: item }, actor));
  const raw = id => read('inventory_purchasing.requests', id);
  const quantity = item => Number(sql(`select quantity from public.inventory_items where id=${lit(item)}`));
  const receipts = id => Number(sql(`select count(*) from inventory_purchasing.receipts where request_id=${lit(id)}`));
  const notifications = () => Number(sql('select count(*) from public.team_notifications'));
  const makeItem = async (unit = 'each') => (await json(await request('/rest/v1/inventory_items', {
    name: 'Synthetic restock component', area_id: area, category: 'Synthetic hardware', quantity: 3, expected_quantity: 3, unit, location_id: home.id,
  }, mentor), 201))[0];
  const configureData = (item, extra = {}) => ({ item_id: item.id, version: 0, supplier: 'Synthetic Supplier',
    product_url: '', purchase_unit: 'box', units_per_pack: 10, pack_cost: 25, ...extra });
  async function configure(item, extra = {}, actor = mentor) { return json(await act('configure', configureData(item, extra), actor)); }
  async function restock(item, packs = 2) {
    const id = randomUUID(); await json(await act('request', { id, item_id: item.id, packs, settings_version: 1, note: 'Synthetic restock test' })); return id;
  }
  const linkData = id => ({ request_id: id, version: raw(id).version, sheet_url: 'https://docs.google.com/spreadsheets/d/synthetic-disposable-test', amount: 60 });
  async function createPO(id) { await json(await act('create_po', linkData(id))); return raw(id).po_id; }
  const financeRPC = (actor, action, id, extra = {}) => rpc('finance_mutate', { action, p: { id, version: read('public.finance_purchase_orders', id).version, ...extra } }, actor);
  async function financeAction(actor, action, id, extra = {}) { return json(await financeRPC(actor, action, id, extra)); }
  async function approvals(id) {
    await financeAction(student, 'submit', id);
    await financeAction(finance, 'approve', id, { slot: 'finance_approver' });
    await financeAction(coach, 'approve', id, { slot: 'po_approver' });
    await financeAction(mentor, 'school_submit', id);
  }
  const orderData = id => ({ request_id: id, version: raw(id).version, reference: 'SYNTHETIC-ORDER' });
  const receiveData = (id, qty = 5, extra = {}) => ({ id: randomUUID(), request_id: id, version: raw(id).version,
    quantity: qty, location_id: home.id, delivery_reference: randomUUID(), note: 'Synthetic delivery', ...extra });
  async function ordered(unit = 'each', config = {}) {
    const item = await makeItem(unit); await configure(item, config); const id = await restock(item); const po = await createPO(id);
    await approvals(po); await json(await act('record_order', orderData(id), mentor)); return { item, id, po };
  }
  async function unchanged(promise, pattern, codes) { const before = state(); await denied(await promise(), pattern, codes); assert.equal(state(), before); }

  const item = await makeItem();
  for (const actor of [student, counter, otherLead, reader, inactive, unprofiled])
    await unchanged(() => act('configure', configureData(item), actor), /Assigned lead|write access/);
  await unchanged(() => act('configure', configureData(item), null), /permission denied/, ['42501']);
  for (const actor of [inactive, unprofiled]) await denied(await rpc('inventory_purchasing_context', { p_item_id: item.id }, actor), /Active/);
  await denied(await rpc('inventory_purchasing_context', { p_item_id: item.id }, null), /permission/, ['42501']);
  for (const actor of [mentor, student]) await denied(await localFetch(base, '/rest/v1/requests?select=*', {
    headers: { ...headers(actor), 'Accept-Profile': 'inventory_purchasing' },
  }), /schema/i, ['PGRST106']);
  await configure(item, {}, lead);
  await unchanged(() => act('request', { id: randomUUID(), item_id: item.id, packs: 2, settings_version: 1 }, reader), /write access/);
  pass('ten real Auth sessions exercise current role/area gates, anonymous denial and private-schema isolation; forged signup metadata grants no privileges');

  const requestId = await restock(item); const originalRequest = raw(requestId);
  await json(await act('request', { id: requestId, item_id: item.id, packs: 2, settings_version: 1, note: 'Synthetic restock test' }));
  assert.deepEqual(raw(requestId), originalRequest);
  await unchanged(() => act('request', { id: requestId, item_id: item.id, packs: 3, settings_version: 1, note: 'Synthetic restock test' }), /retry does not match/);
  await unchanged(() => act('request', { id: randomUUID(), item_id: item.id, packs: 2, settings_version: 1 }, counter), /already has an open/);
  await configure(item, { version: 1, units_per_pack: 12.5, pack_cost: 30 });
  assert.equal(Number(raw(requestId).quantity), 20); assert.equal(Number(raw(requestId).units_per_pack), 10);
  await unchanged(() => act('create_po', { ...linkData(requestId), amount: 1 }), /below the estimated/);
  assert.equal(sql('select count(*) from public.finance_purchase_orders'), '0');
  const beforeDraftNotices = notifications(); const po = await createPO(requestId);
  assert.equal(read('public.finance_purchase_orders', po).status, 'draft'); assert.equal(notifications(), beforeDraftNotices);
  const hidden = (await inspect(item.id)).requests.find(row => row.id === requestId);
  assert.equal(hidden.po, null);
  for (const key of ['po_id', 'po_revision', 'requester_id', 'order_reference', 'ordered_by']) assert(!Object.hasOwn(hidden, key));
  assert.equal((await inspect(item.id, student)).requests.find(row => row.id === requestId).po.id, po);
  assert.deepEqual(await json(await get(`finance_purchase_orders?id=eq.${po}`, counter)), []);
  await unchanged(() => act('create_po', { ...linkData(requestId), version: 1 }), /changed/, ['40001']);
  assert.equal(sql('select count(*) from public.finance_purchase_orders'), '1');
  pass('request replay and one-open-item rules hold; unit conversions are snapshotted; draft creation is atomic, duplicate-proof, Finance-scoped and emits no notification');

  await financeAction(student, 'submit', po);
  await financeAction(finance, 'approve', po, { slot: 'finance_approver' });
  await unchanged(() => act('record_order', orderData(requestId), mentor), /Both current/);
  await unchanged(() => financeRPC(finance, 'approve', po, { slot: 'po_approver', override_reason: 'Synthetic bypass attempt' }), /Configured|Only mentors/);
  await financeAction(coach, 'approve', po, { slot: 'po_approver' });
  await unchanged(() => act('record_order', orderData(requestId), mentor), /school submission/);
  await financeAction(mentor, 'school_submit', po);
  await unchanged(() => act('record_order', orderData(requestId), counter), /submitter|access/);
  await json(await act('record_order', orderData(requestId), mentor)); assert.equal(quantity(item.id), 3);
  assert.equal(sql(`select count(distinct actor_id) from public.finance_po_approvals where po_id=${lit(po)} and action='approved'`), '2');
  pass('stock does not change before receiving; two distinct current-revision approvals and explicit school submission are mandatory through the real Finance RPC');

  const converted = await ordered('ft', { units_per_pack: 12.5, pack_cost: 20 });
  assert.equal(Number(raw(converted.id).quantity), 25);
  const beforeReceiptNotices = notifications();
  const first = receiveData(converted.id, 7.5, { location_id: project.id, delivery_reference: ' Delivery-A ' });
  await json(await act('receive', first, counter)); const afterFirst = state();
  await json(await act('receive', first, counter)); assert.equal(state(), afterFirst);
  assert.equal(quantity(converted.item.id), 10.5); assert.equal(raw(converted.id).state, 'partial'); assert.equal(receipts(converted.id), 1);
  assert.equal(Number(sql(`select quantity from public.inventory_balances where inventory_item_id=${lit(converted.item.id)} and location_id=${lit(home.id)}`)), 3);
  assert.equal(Number(sql(`select quantity from public.inventory_balances where inventory_item_id=${lit(converted.item.id)} and location_id=${lit(project.id)}`)), 7.5);
  await unchanged(() => act('receive', { ...first, quantity: 8 }, counter), /retry does not match/);
  await unchanged(() => act('receive', first, student), /retry does not match/);
  await unchanged(() => act('receive', receiveData(converted.id, 1, { delivery_reference: 'delivery-a' }), counter), /already been received/);
  await unchanged(() => act('receive', receiveData(converted.id, 1, { delivery_reference: '\u00a0DELIVERY-A\u00a0' }), counter), /already been received/);
  await unchanged(() => act('receive', receiveData(converted.id, 0.0000001), counter), /6 decimal places/);
  await unchanged(() => act('receive', receiveData(converted.id, 18), counter), /no greater/);
  for (const qty of [0, -1, 'NaN', 'Infinity']) await unchanged(() => act('receive', receiveData(converted.id, qty), counter), /positive|no greater/);
  const last = receiveData(converted.id, 17.5, { delivery_reference: 'Delivery-B' });
  await json(await act('receive', last, counter)); const completed = state();
  await json(await act('receive', last, counter)); assert.equal(state(), completed);
  assert.equal(raw(converted.id).state, 'received'); assert.equal(quantity(converted.item.id), 28); assert.equal(receipts(converted.id), 2);
  assert.equal(notifications(), beforeReceiptNotices);
  assert.equal(sql(`select count(*) from public.inventory_movements where inventory_item_id=${lit(converted.item.id)} and note like 'Restock receipt %'`), '2');
  const projection = (await inspect(converted.item.id)).receipts;
  assert(projection.every(row => !Object.hasOwn(row, 'delivery_reference') && !Object.hasOwn(row, 'note')));
  pass('partial and final delivery replay adds stock once in stock units, preserves other locations, normalizes duplicate delivery references and never sends notifications');

  const guarded = await ordered();
  await json(await request(`/rest/v1/inventory_items?id=eq.${guarded.item.id}`, { unit: 'box' }, mentor, 'PATCH'));
  await unchanged(() => act('receive', receiveData(guarded.id), counter), /stock unit changed/);
  await json(await request(`/rest/v1/inventory_items?id=eq.${guarded.item.id}`, { unit: 'each' }, mentor, 'PATCH'));
  await unchanged(() => act('receive', receiveData(guarded.id, 1, { location_id: randomUUID() }), counter), /non-travel receiving location/);
  const trip = await json(await rpc('inventory_action', { p_action: 'create_trip', p_data: { name: 'Synthetic receipt destination rejection' } }, mentor));
  const travel = sql(`select id from public.locations where trip_id=${lit(trip.id)} limit 1`);
  await unchanged(() => act('receive', receiveData(guarded.id, 1, { location_id: travel }), counter), /non-travel/);
  sql(`update public.profiles set active=false where id=${lit(counter.id)}`);
  await unchanged(() => act('receive', receiveData(guarded.id), counter), /write access/);
  sql(`update public.profiles set active=true where id=${lit(counter.id)}`);
  assert.equal(quantity(guarded.item.id), 3); assert.equal(receipts(guarded.id), 0);
  pass('changed stock units, bad/travel receiving locations and revoked real Auth sessions fail without receipt, balance, audit or Finance mutations');

  const atomic = await ordered(); const atomicPayload = receiveData(atomic.id, 5);
  sql(`create function private.synthetic_receipt_failure() returns trigger language plpgsql as $$begin
    if new.request_id=${lit(atomic.id)} then raise exception 'Synthetic receipt write failure';end if;return new;end$$;
    create trigger synthetic_receipt_failure before insert on inventory_purchasing.receipts for each row execute function private.synthetic_receipt_failure();`);
  try { await unchanged(() => act('receive', atomicPayload, counter), /Synthetic receipt write failure/, ['P0001']); }
  finally { sql('drop trigger synthetic_receipt_failure on inventory_purchasing.receipts;drop function private.synthetic_receipt_failure()'); }
  await json(await act('receive', atomicPayload, counter)); assert.equal(quantity(atomic.item.id), 8); assert.equal(receipts(atomic.id), 1);
  pass('a receipt persistence failure rolls back stock, movements and history; the original receipt request succeeds safely after recovery');

  const competing = await ordered();
  const payloads = [receiveData(competing.id, 13), receiveData(competing.id, 13)];
  const responses = await Promise.all(payloads.map(payload => act('receive', payload, counter)));
  assert.equal(responses.filter(response => response.ok).length, 1);
  await json(responses.find(response => response.ok)); await denied(responses.find(response => !response.ok), /changed/, ['40001']);
  assert.equal(quantity(competing.item.id), 16); assert.equal(Number(raw(competing.id).received), 13); assert.equal(receipts(competing.id), 1);
  await unchanged(() => act('receive', receiveData(competing.id, 13), counter), /no greater/);
  const same = receiveData(competing.id, 7); const sameResponses = await Promise.all([act('receive', same, counter), act('receive', same, counter)]);
  for (const response of sameResponses) await json(response);
  assert.equal(quantity(competing.item.id), 23); assert.equal(receipts(competing.id), 2); assert.equal(raw(competing.id).state, 'received');
  pass('parallel HTTP competing deliveries cannot overspend the remainder; simultaneous identical final receipts both succeed with one physical mutation');

  const revised = await makeItem(); await configure(revised); const revisedId = await restock(revised); const revisedPO = await createPO(revisedId);
  await financeAction(student, 'submit', revisedPO);
  await financeAction(coach, 'approve', revisedPO, { slot: 'finance_approver', override_reason: 'Synthetic single-slot override' });
  await unchanged(() => financeRPC(coach, 'approve', revisedPO, { slot: 'po_approver' }), /Two distinct people/);
  await financeAction(mentor, 'approve', revisedPO, { slot: 'po_approver', override_reason: 'Synthetic independent override' });
  await financeAction(student, 'edit', revisedPO, { area_id: area, sheet_url: 'https://docs.google.com/spreadsheets/d/synthetic-disposable-test', vendor: 'Synthetic Supplier', amount: 60, purpose: 'Synthetic revised order' });
  await financeAction(student, 'submit', revisedPO);
  await unchanged(() => financeRPC(mentor, 'school_submit', revisedPO), /Both current/);
  await unchanged(() => act('record_order', orderData(revisedId), mentor), /Both current/);
  assert.equal(read('public.finance_purchase_orders', revisedPO).revision, 2); assert.equal(quantity(revised.id), 3);
  pass('one mentor cannot fill both approval slots; resubmission invalidates old approvals and prevents recording the order');
  assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authDefinition, 'Real Auth function must stay unchanged');
  return checks;
}
