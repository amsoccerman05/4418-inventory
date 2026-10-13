// End-to-end shared-stack regression: receiving into a checked-out tool location
// increases free stock without releasing a borrower's claim or changing ownership.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { phaseAPI, lit, area } from './phase3-test-support.mjs';
export const phase5CombinedSourceFiles = ['tests/integration/phase5-combined.mjs'];
export async function runCombinedIntegration(context) {
  const { sql } = context;
  const { checks, request, rpc, get, json, denied, session, read, fingerprint, pass } = phaseAPI(context, '3+4+5');
  const mentor = await session('mentor', 'mentor'), coach = await session('coach', 'mentor'), student = await session('student', 'student');
  const inventory = (action, data, actor = mentor) => rpc('inventory_action', { p_action: action, p_data: data }, actor);
  const purchasing = (action, data, actor = student) => rpc('inventory_purchasing_action', { p_action: action, p_data: data }, actor);
  const packing = (action, data) => rpc('packing_template_action', { p_action: action, p_data: data }, mentor);
  const custody = (action, data) => rpc('tool_checkout_action', { p_action: action, p_data: data }, student);
  const [home] = await json(await request('/rest/v1/locations', { name: 'Synthetic combined home', location_type: 'Drawer' }, mentor), 201);
  const [project] = await json(await request('/rest/v1/locations', { name: 'Synthetic combined loan location', location_type: 'Storage' }, mentor), 201);
  const [item] = await json(await request('/rest/v1/inventory_items', { name: 'Synthetic combined borrowed drill', area_id: area,
    category: 'Synthetic tools', item_type: 'Tool', ownership: 'Shared / School', quantity: 2, expected_quantity: 2, unit: 'each', location_id: home.id }, mentor), 201);
  async function trip(name) { const { id } = await json(await inventory('create_trip', { name: `Synthetic ${name}` }));
    const [destination] = await json(await get(`locations?trip_id=eq.${id}&name=eq.Trailer`, mentor)); return { id, to: destination.id }; }
  const source = await trip('combined source');
  const planned = await json(await inventory('approve', { tripId: source.id, itemId: item.id, from: home.id, to: source.to, quantity: 2 }));
  await json(await inventory('resolve', { manifestId: planned.id, quantity: 2, note: 'Synthetic planned source' }));
  await json(await inventory('trip_status', { tripId: source.id, status: 'closed' }));
  const template = await json(await packing('save', { requestId: randomUUID(), name: 'Synthetic combined kit', sourceTripId: source.id }));
  const target = await trip('combined target');
  const checkedOut = await json(await custody('checkout', { operationId: randomUUID(), itemId: item.id, from: home.id, to: project.id,
    quantity: 2, borrower: 'Synthetic combined borrower', project: 'Synthetic combined project', expectedReturn: '2026-12-31', note: 'Synthetic shared-stack regression' }));
  const initialLoan = read('public.tool_loans', checkedOut.id);
  const balance = location => Number(sql(`select coalesce(sum(quantity),0) from public.inventory_balances where inventory_item_id=${lit(item.id)} and location_id=${lit(location)}`));
  const state = () => fingerprint(['public.inventory_items', 'public.inventory_balances', 'public.inventory_events', 'public.inventory_movements',
    'public.tool_loans', 'private.tool_checkout_operations', 'public.trip_manifest_items', 'private.packing_template_requests',
    'inventory_purchasing.requests', 'inventory_purchasing.receipts', 'inventory_purchasing.history']);
  async function review(quantity = 2) {
    const [current] = await json(await get(`inventory_items?id=eq.${item.id}`, mentor));
    const [atProject] = await json(await get(`inventory_balances?inventory_item_id=eq.${item.id}&location_id=eq.${project.id}`, mentor));
    return { requestId: randomUUID(), templateId: template.id, tripId: target.id, reviewed: true,
      lines: [{ itemId: item.id, quantity, homeLocationId: project.id, destinationId: target.to, itemUpdatedAt: current.updated_at, balanceUpdatedAt: atProject.updated_at }] };
  }
  const beforeRestockReview = await review(); let before = state();
  await denied(await packing('approve', beforeRestockReview), /Outstanding tool loans|Not enough available/); assert.equal(state(), before);
  await json(await purchasing('configure', { item_id: item.id, version: 0, supplier: 'Synthetic Supplier', purchase_unit: 'box', units_per_pack: 2, pack_cost: 20 }, mentor));
  const requestId = randomUUID();
  await json(await purchasing('request', { id: requestId, item_id: item.id, packs: 1, settings_version: 1, note: 'Synthetic replenish borrowed-tool location' }));
  await json(await purchasing('create_po', { request_id: requestId, version: 1, sheet_url: 'https://docs.google.com/spreadsheets/d/synthetic-combined', amount: 20 }));
  const po = read('inventory_purchasing.requests', requestId).po_id;
  async function finance(actor, action, extra = {}) { return json(await rpc('finance_mutate', { action, p: {
    id: po, version: read('public.finance_purchase_orders', po).version, ...extra,
  } }, actor)); }
  await finance(student, 'submit');
  await finance(mentor, 'approve', { slot: 'finance_approver', override_reason: 'Synthetic first independent approval' });
  await finance(coach, 'approve', { slot: 'po_approver', override_reason: 'Synthetic second independent approval' });
  await finance(mentor, 'school_submit');
  await json(await purchasing('record_order', { request_id: requestId, version: read('inventory_purchasing.requests', requestId).version, reference: 'SYNTHETIC-COMBINED' }, mentor));
  assert.equal(read('public.inventory_items', item.id).quantity, 2);
  const receipt = { id: randomUUID(), request_id: requestId, version: read('inventory_purchasing.requests', requestId).version,
    quantity: 2, location_id: project.id, delivery_reference: 'Synthetic combined delivery', note: 'Synthetic receipt into checked-out location' };
  await json(await purchasing('receive', receipt));
  assert.equal(balance(project.id), 4); assert.equal(balance(home.id), 0);
  assert.equal(read('public.inventory_items', item.id).quantity, 4); assert.equal(read('public.inventory_items', item.id).ownership, 'Shared / School');
  assert.deepEqual(read('public.tool_loans', checkedOut.id), initialLoan);
  before = state(); await denied(await packing('approve', beforeRestockReview), /Availability changed/, ['40001']); assert.equal(state(), before);
  const approved = await json(await packing('approve', await review())); assert.equal(approved.manifestIds.length, 1);
  before = state(); await denied(await packing('approve', await review(1)), /Outstanding tool loans|Not enough available/); assert.equal(state(), before);
  pass('restock received at a loan location adds only free stock; custody and ownership persist; stale review fails and a fresh template can reserve only the new unclaimed quantity');

  await json(await custody('return', { operationId: randomUUID(), loanId: checkedOut.id, quantity: 2, updatedAt: initialLoan.updated_at, note: 'Synthetic original borrower return' }));
  assert.equal(read('public.tool_loans', checkedOut.id).status, 'returned'); assert.equal(balance(home.id), 2); assert.equal(balance(project.id), 2);
  await json(await inventory('trip_status', { tripId: target.id, status: 'packing' }));
  await json(await inventory('pack', { manifestId: approved.manifestIds[0], quantity: 2 }, student));
  await json(await inventory('return', { manifestId: approved.manifestIds[0], quantity: 2 }, student));
  await json(await inventory('trip_status', { tripId: target.id, status: 'closed' }));
  before = state(); await json(await purchasing('receive', receipt)); assert.equal(state(), before);
  assert.equal(read('public.inventory_items', item.id).quantity, 4); assert.equal(read('public.inventory_items', item.id).ownership, 'Shared / School');
  assert.equal(read('public.trip_manifest_items', approved.manifestIds[0]).ownership, 'Shared / School');
  assert.equal(sql(`select count(*) from inventory_purchasing.receipts where request_id=${lit(requestId)}`), '1');
  pass('the original borrower return and later trip pack/return remain independent; a delayed duplicate receipt after both workflows cannot add stock or release custody again');
  return checks;
}
