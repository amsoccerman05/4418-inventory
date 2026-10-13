// Real Auth/PostgREST phase 5 checks, independent of Finance/restock fixtures.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { phaseAPI, lit, area } from './phase3-test-support.mjs';
import { localFetch } from './inventory-safety.mjs';
export const phase5Migration = '20261013234535_tool_checkouts.sql';
export const phase5SourceFiles = [`supabase/migrations/${phase5Migration}`, 'tests/integration/phase3-test-support.mjs', 'tests/integration/phase5-checkouts.mjs'];

export async function runPhase5Integration(context) {
  const { sql, base } = context;
  const { checks, headers, request, rpc, get, json, denied, session, schemaReady, fingerprint, read, pass } = phaseAPI(context, '5');
  assert.equal(sql('select count(*) from public.tool_loans'), '0', 'Phase 5 requires fresh synthetic loans');
  const mentor = await session('mentor', 'mentor'), lead = await session('lead', 'lead', true, area);
  const student = await session('student', 'student'), counter = await session('counter', 'student');
  const reader = await session('reader', 'readonly'), inactive = await session('inactive', 'student', false), unprofiled = await session('unprofiled', null);
  await schemaReady('tool_checkout_features', {}, reader);
  const [home] = await json(await request('/rest/v1/locations', { name: 'Synthetic tool home', location_type: 'Drawer' }, mentor), 201);
  const [project] = await json(await request('/rest/v1/locations', { name: 'Synthetic tool project', location_type: 'Storage' }, mentor), 201);
  const tool = (action, data, actor = student) => rpc('tool_checkout_action', { p_action: action, p_data: data }, actor);
  const inventory = (action, data, actor = student) => rpc('inventory_action', { p_action: action, p_data: data }, actor);
  const newItem = async (quantity = 4, extra = {}) => (await json(await request('/rest/v1/inventory_items', {
    name: 'Synthetic checked-out drill', area_id: area, category: 'Synthetic tools', item_type: 'Tool', ownership: 'Shared / School',
    quantity, expected_quantity: quantity, location_id: home.id, ...extra,
  }, mentor), 201))[0];
  const checkout = (item, quantity = 1, extra = {}) => ({ operationId: randomUUID(), itemId: item.id, from: home.id, to: project.id,
    quantity, borrower: 'Synthetic borrower', project: 'Synthetic robot project', expectedReturn: '2026-12-31', note: 'Disposable local test', ...extra });
  const loan = id => read('public.tool_loans', id);
  const returnData = (id, quantity = 1, extra = {}) => ({ operationId: randomUUID(), loanId: id, quantity, updatedAt: loan(id).updated_at, note: 'Synthetic returned tool', ...extra });
  const tables = ['public.inventory_items', 'public.inventory_balances', 'public.inventory_events', 'public.inventory_movements',
    'public.tool_loans', 'private.tool_checkout_operations', 'public.trip_manifest_items'];
  const state = () => fingerprint(tables);
  const physical = item => sql(`select jsonb_agg(to_jsonb(b) order by id) from public.inventory_balances b where inventory_item_id=${lit(item.id)}`);
  const stock = item => Number(sql(`select quantity from public.inventory_items where id=${lit(item.id)}`));
  const balance = (item, location) => Number(sql(`select coalesce(sum(quantity),0) from public.inventory_balances where inventory_item_id=${lit(item.id)} and location_id=${lit(location)}`));
  const loanCount = item => Number(sql(`select count(*) from public.tool_loans where inventory_item_id=${lit(item.id)}`));
  async function unchanged(call, pattern, codes) { const before = state(); await denied(await call(), pattern, codes); assert.equal(state(), before); }
  async function newTrip() {
    const row = await json(await inventory('create_trip', { name: 'Synthetic custody guarded trip' }, mentor));
    const [destination] = await json(await get(`locations?trip_id=eq.${row.id}&name=eq.Trailer`, mentor)); return { id: row.id, to: destination.id };
  }

  const item = await newItem(); const data = checkout(item, 2);
  for (const actor of [reader, inactive, unprofiled]) await unchanged(() => tool('checkout', data, actor), /permission/, ['42501']);
  await unchanged(() => tool('checkout', data, null), /permission/, ['42501']);
  const first = await json(await tool('checkout', data));
  assert.equal(stock(item), 4); assert.equal(balance(item, home.id), 2); assert.equal(balance(item, project.id), 2);
  assert.equal(loan(first.id).created_by, student.id); assert.equal(read('public.inventory_items', item.id).ownership, 'Shared / School');
  const afterCheckout = state(); assert.equal((await json(await tool('checkout', data))).replayed, true); assert.equal(state(), afterCheckout);
  await unchanged(() => tool('checkout', { ...data, quantity: 1 }), /different request/);
  await unchanged(() => tool('checkout', data, mentor), /different request/);
  for (const actor of [student, lead, mentor]) for (const method of ['PATCH', 'DELETE'])
    await unchanged(() => request(`/rest/v1/tool_loans?id=eq.${first.id}`, method === 'PATCH' ? { borrower: 'Forged borrower' } : undefined, actor, method), /permission/, ['42501']);
  assert.equal((await json(await get(`tool_loans?id=eq.${first.id}`, reader))).length, 1);
  for (const actor of [inactive, unprofiled]) assert.deepEqual(await json(await get(`tool_loans?id=eq.${first.id}`, actor)), []);
  await denied(await localFetch(base, '/rest/v1/tool_checkout_operations?select=*', { headers: { ...headers(mentor), 'Accept-Profile': 'private' } }), /schema/i, ['PGRST106']);
  pass('seven real Auth sessions enforce current access and direct-write restrictions; checkout replay commits one actor-bound loan and preserves ownership and total stock');

  for (const quantity of [0, -1, 0.5, 'NaN', 'Infinity', 3]) await unchanged(() => tool('checkout', checkout(item, quantity)), /whole number|Not enough/);
  const part = await newItem(4, { item_type: 'Part' });
  await unchanged(() => tool('checkout', checkout(part)), /Only Tool/);
  await unchanged(() => tool('checkout', checkout(item, 1, { borrower: ' ' })), /who has/);
  await unchanged(() => tool('checkout', checkout(item, 1, { expectedReturn: '' })), /return date/);
  await unchanged(() => tool('checkout', checkout(item, 1, { expectedReturn: '2026-02-30' })), /date/, ['22008']);
  await unchanged(() => tool('checkout', checkout(item, 1, { to: home.id })), /different/);
  const travel = await newTrip(); await unchanged(() => tool('checkout', checkout(item, 1, { to: travel.to })), /non-travel/);
  pass('only whole available Tool units with a borrower, real calendar date and two active non-travel locations can be checked out');

  const second = await json(await tool('checkout', checkout(item, 1, { borrower: 'Independent synthetic borrower' }), counter));
  await json(await inventory('move', { itemId: item.id, from: home.id, to: project.id, quantity: 1 }));
  await json(await inventory('move', { itemId: item.id, from: project.id, to: home.id, quantity: 1 }));
  await unchanged(() => inventory('move', { itemId: item.id, from: project.id, to: home.id, quantity: 1 }), /Outstanding tool loans/);
  await unchanged(() => inventory('adjust', { itemId: item.id, from: project.id, quantity: 2, updatedAt: read('public.inventory_items', item.id).updated_at }), /Outstanding tool loans/);
  for (const patch of [{ item_type: 'Consumable' }, { ownership: 'FRC 4418' }, { location_id: project.id }])
    await unchanged(() => request(`/rest/v1/inventory_items?id=eq.${item.id}`, patch, mentor, 'PATCH'), /outstanding tool loans/i);
  await unchanged(() => inventory('approve', { tripId: travel.id, itemId: item.id, from: project.id, to: travel.to, quantity: 1 }, lead), /Outstanding tool loans/);
  assert.equal(stock(item), 4); assert.equal(balance(item, project.id), 3); assert.equal(loan(second.id).returned_quantity, 0);
  pass('outstanding claims reserve physical balances across ordinary moves, absolute counts, ownership/type/home edits and trip approvals, while unclaimed units remain movable');

  const beforeMissing = physical(item);
  const missing = { operationId: randomUUID(), loanId: first.id, updatedAt: loan(first.id).updated_at, note: 'Synthetic not at expected location' };
  await json(await tool('mark_missing', missing)); const afterMissing = state(); await json(await tool('mark_missing', missing)); assert.equal(state(), afterMissing);
  assert.equal(loan(first.id).status, 'missing'); assert.equal(physical(item), beforeMissing); assert.equal(stock(item), 4);
  const partial = returnData(first.id); await json(await tool('return', partial, lead)); const afterPartial = state();
  await json(await tool('return', partial, lead)); assert.equal(state(), afterPartial);
  assert.equal(loan(first.id).returned_quantity, 1); assert.equal(loan(first.id).status, 'missing'); assert.equal(loan(second.id).returned_quantity, 0);
  await unchanged(() => tool('return', { ...partial, operationId: randomUUID() }), /changed/, ['40001']);
  const found = { operationId: randomUUID(), loanId: first.id, updatedAt: loan(first.id).updated_at, note: 'Synthetic remaining tool found' };
  await json(await tool('mark_found', found)); assert.equal(loan(first.id).status, 'out');
  await json(await tool('return', returnData(first.id), counter)); assert.equal(loan(first.id).status, 'returned');
  assert.equal(loan(second.id).status, 'out'); assert.equal(loan(second.id).returned_quantity, 0);
  assert.equal(balance(item, home.id), 3); assert.equal(balance(item, project.id), 1); assert.equal(stock(item), 4);
  assert.equal(read('public.inventory_items', item.id).ownership, 'Shared / School');
  pass('missing/found status never changes stock; partial and final returns affect exactly one borrower claim, and retries preserve other outstanding loans');

  const reservedItem = await newItem(2); const reservedTrip = await newTrip();
  const approval = await json(await inventory('approve', { tripId: reservedTrip.id, itemId: reservedItem.id, from: home.id, to: reservedTrip.to, quantity: 2 }, lead));
  await unchanged(() => tool('checkout', checkout(reservedItem, 2)), /Not enough available.*trip approvals/);
  await json(await inventory('resolve', { manifestId: approval.id, quantity: 2, note: 'Synthetic use checkout instead' }, mentor));
  const held = await json(await tool('checkout', checkout(reservedItem, 2)));
  await json(await inventory('trip_status', { tripId: reservedTrip.id, status: 'packing' }, mentor));
  await unchanged(() => inventory('pack', { manifestId: approval.id, quantity: 2 }), /Not enough|Allocation changed|Source and destination/);
  await json(await tool('return', returnData(held.id, 2)));
  const afterReturnApproval = await json(await inventory('approve', { tripId: reservedTrip.id, itemId: reservedItem.id, from: home.id, to: reservedTrip.to, quantity: 2 }, lead));
  await json(await inventory('pack', { manifestId: afterReturnApproval.id, quantity: 2 }));
  await json(await inventory('return', { manifestId: afterReturnApproval.id, quantity: 2 }));
  await json(await inventory('trip_status', { tripId: reservedTrip.id, status: 'closed' }, mentor));
  assert.equal(stock(reservedItem), 2); assert.equal(read('public.inventory_items', reservedItem.id).ownership, 'Shared / School');
  pass('existing trip approvals prevent checkout, specific returns restore availability, and normal pack/return/close still works after custody is released');

  const parallelItem = await newItem(2); const parallelPayload = checkout(parallelItem, 2);
  const checkouts = await Promise.all([tool('checkout', parallelPayload), tool('checkout', parallelPayload)]);
  const checkoutResults = await Promise.all(checkouts.map(response => json(response))); assert.equal(checkoutResults[0].id, checkoutResults[1].id); assert.equal(loanCount(parallelItem), 1);
  const parallelLoan = checkoutResults[0].id, returns = [returnData(parallelLoan), returnData(parallelLoan)];
  const returnResponses = await Promise.all(returns.map(payload => tool('return', payload)));
  assert.equal(returnResponses.filter(response => response.ok).length, 1); await json(returnResponses.find(response => response.ok));
  await denied(returnResponses.find(response => !response.ok), /changed/, ['40001']); assert.equal(loan(parallelLoan).returned_quantity, 1);
  const final = returnData(parallelLoan); const finalResponses = await Promise.all([tool('return', final), tool('return', final)]);
  for (const response of finalResponses) await json(response);
  assert.equal(loan(parallelLoan).status, 'returned'); assert.equal(balance(parallelItem, home.id), 2); assert.equal(balance(parallelItem, project.id), 0);
  assert.equal(sql(`select count(*) from public.inventory_movements where inventory_item_id=${lit(parallelItem.id)} and movement_type='tool_return'`), '2');
  pass('parallel HTTP checkouts replay once; competing return operations cannot spend the same version; an identical final return commits once after closure');

  const atomicItem = await newItem(2), atomicData = checkout(atomicItem, 2);
  sql(`create function private.synthetic_checkout_receipt_failure() returns trigger language plpgsql as $$begin
    if new.id=${lit(atomicData.operationId)} then raise exception 'Synthetic tool operation receipt failure';end if;return new;end$$;
    create trigger synthetic_checkout_receipt_failure before insert on private.tool_checkout_operations for each row execute function private.synthetic_checkout_receipt_failure();`);
  try { await unchanged(() => tool('checkout', atomicData), /Synthetic tool operation receipt failure/, ['P0001']); }
  finally { sql('drop trigger synthetic_checkout_receipt_failure on private.tool_checkout_operations;drop function private.synthetic_checkout_receipt_failure()'); }
  assert.equal(loanCount(atomicItem), 0); assert.equal(balance(atomicItem, home.id), 2);
  const recovered = await json(await tool('checkout', atomicData)); assert.equal(loanCount(atomicItem), 1);
  sql(`update public.profiles set active=false where id=${lit(student.id)}`);
  await unchanged(() => tool('mark_missing', { operationId: randomUUID(), loanId: recovered.id, updatedAt: loan(recovered.id).updated_at, note: 'Synthetic denied update' }), /permission/, ['42501']);
  assert.deepEqual(await json(await get(`tool_loans?id=eq.${recovered.id}`, student)), []);
  pass('receipt persistence failure rolls back loan, stock and audit together; original replay recovers; revocation blocks an already-issued Auth token');
  return checks;
}
