// Real Auth/PostgREST extension; requires only baseline + phase 4 schema.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { phaseAPI, lit, area } from './phase3-test-support.mjs';
import { localFetch } from './inventory-safety.mjs';
export const phase4Migration = '20261013234533_packing_templates.sql';
export const phase4SourceFiles = [`supabase/migrations/${phase4Migration}`, 'tests/integration/phase3-test-support.mjs', 'tests/integration/phase4-templates.mjs'];

export async function runPhase4Integration(context) {
  const { sql, base } = context;
  const { checks, headers, request, rpc, get, json, denied, session, schemaReady, fingerprint, read, pass } = phaseAPI(context, '4');
  assert.equal(sql('select count(*) from public.packing_templates'), '0', 'Phase 4 requires fresh synthetic templates');
  const mentor = await session('mentor', 'mentor'), admin = await session('admin', 'admin');
  const lead = await session('lead', 'lead', true, area), student = await session('student', 'student');
  const reader = await session('reader', 'readonly'), inactive = await session('inactive', 'mentor', false), unprofiled = await session('unprofiled', null);
  const act = (action, data, actor = mentor) => rpc('inventory_action', { p_action: action, p_data: data }, actor);
  const packing = (action, data, actor = mentor) => rpc('packing_template_action', { p_action: action, p_data: data }, actor);
  const [home] = await json(await request('/rest/v1/locations', { name: 'Synthetic packing home', location_type: 'Drawer' }, mentor), 201);
  const [project] = await json(await request('/rest/v1/locations', { name: 'Synthetic packing project', location_type: 'Storage' }, mentor), 201);
  const newItem = async name => (await json(await request('/rest/v1/inventory_items', { name, area_id: area, category: 'Synthetic tools',
    item_type: 'Tool', ownership: 'Shared / School', quantity: 2, expected_quantity: 2, location_id: home.id }, mentor), 201))[0];
  const tool = await newItem('Synthetic packing drill'), secondTool = await newItem('Synthetic packing wrench');
  async function trip(name) {
    const row = await json(await act('create_trip', { name: `Synthetic ${name}` }));
    const [destination] = await json(await get(`locations?trip_id=eq.${row.id}&name=eq.Trailer`, mentor));
    assert(destination); return { id: row.id, to: destination.id };
  }
  async function line(itemId, target, quantity = 1, location = home.id) {
    const [item] = await json(await get(`inventory_items?id=eq.${itemId}`, mentor));
    const [balance] = await json(await get(`inventory_balances?inventory_item_id=eq.${itemId}&location_id=eq.${location}`, mentor));
    return { itemId, quantity, homeLocationId: location, destinationId: target.to, itemUpdatedAt: item.updated_at, balanceUpdatedAt: balance.updated_at };
  }
  const tables = ['public.inventory_items', 'public.inventory_balances', 'public.inventory_events', 'public.inventory_movements',
    'public.packing_templates', 'private.packing_template_requests', 'public.trip_manifest_items', 'public.trips'];
  const state = () => fingerprint(tables);
  const physical = () => fingerprint(['public.inventory_items', 'public.inventory_balances']);
  const manifests = target => Number(sql(`select count(*) from public.trip_manifest_items where trip_id=${lit(target.id)}`));
  async function unchanged(call, pattern, codes) { const before = state(); await denied(await call(), pattern, codes); assert.equal(state(), before); }
  async function resolveTarget(target) {
    const rows = await json(await get(`trip_manifest_items?trip_id=eq.${target.id}&status=eq.approved`, mentor));
    for (const row of rows) await json(await act('resolve', { manifestId: row.id, quantity: row.quantity, note: 'Synthetic review cleanup' }));
  }

  const source = await trip('closed packing source');
  for (const item of [tool, secondTool]) {
    const approved = await json(await act('approve', { tripId: source.id, itemId: item.id, from: home.id, to: source.to, quantity: 2 }, lead));
    if (item === tool) await json(await act('trip_status', { tripId: source.id, status: 'packing' }));
    await json(await act('pack', { manifestId: approved.id, quantity: 2 }, student));
    await json(await act('return', { manifestId: approved.id, quantity: 1 }, student));
    await json(await act('return', { manifestId: approved.id, quantity: 1 }, student));
  }
  await json(await act('trip_status', { tripId: source.id, status: 'closed' }));
  const save = { requestId: randomUUID(), name: 'Synthetic reusable kit', sourceTripId: source.id };
  const beforeSavePhysical = physical(), beforeSaveMovements = sql('select count(*) from public.inventory_movements');
  const saved = await schemaReady('packing_template_action', { p_action: 'save', p_data: save }, lead);
  assert.deepEqual(await json(await packing('save', save, lead)), saved);
  const template = read('public.packing_templates', saved.id);
  assert.equal(template.created_by, lead.id); assert.equal(template.lines.length, 2);
  for (const savedLine of template.lines) {
    assert.deepEqual(Object.keys(savedLine).sort(), ['homeLocationId', 'itemId', 'quantity']);
    assert.equal(savedLine.quantity, 2); assert.equal(savedLine.homeLocationId, home.id);
  }
  assert.equal(physical(), beforeSavePhysical); assert.equal(sql('select count(*) from public.inventory_movements'), beforeSaveMovements);
  pass('saving a kit from a closed trip aggregates split packs/returns into intended quantities and copies no physical, ownership, destination or status state');

  for (const actor of [student, reader, inactive, unprofiled]) for (const action of ['save', 'approve'])
    await unchanged(() => packing(action, { ...save, requestId: randomUUID() }, actor), /lead, admin or mentor/, ['42501']);
  await unchanged(() => packing('save', save, null), /permission/, ['42501']);
  for (const actor of [reader, student, lead, mentor, admin]) assert.equal((await json(await get(`packing_templates?id=eq.${saved.id}`, actor))).length, 1);
  for (const actor of [inactive, unprofiled]) assert.deepEqual(await json(await get(`packing_templates?id=eq.${saved.id}`, actor)), []);
  for (const method of ['PATCH', 'DELETE']) await unchanged(() => request(`/rest/v1/packing_templates?id=eq.${saved.id}`, method === 'PATCH' ? { lines: [] } : undefined, mentor, method), /permission/, ['42501']);
  await denied(await localFetch(base, '/rest/v1/packing_template_requests?select=*', { headers: { ...headers(mentor), 'Accept-Profile': 'private' } }), /schema/i, ['PGRST106']);
  await unchanged(() => packing('save', { ...save, name: 'Different payload' }, lead), /different input/);
  pass('seven real Auth sessions preserve role/read boundaries; direct template edits and private receipt reads are denied; idempotency is payload-bound');

  const target = await trip('reviewed destination');
  const approval = { requestId: randomUUID(), templateId: saved.id, tripId: target.id, reviewed: true, lines: [await line(tool.id, target), await line(secondTool.id, target)] };
  const beforeApprove = physical(); const result = await json(await packing('approve', approval, lead));
  assert.equal(result.manifestIds.length, 2); assert.equal(manifests(target), 2);
  const approvedState = state(); assert.deepEqual(await json(await packing('approve', approval, lead)), result); assert.equal(state(), approvedState);
  assert.equal(physical(), beforeApprove);
  for (const id of result.manifestIds) { const row = read('public.trip_manifest_items', id); assert.equal(row.status, 'approved'); assert.equal(row.ownership, 'Shared / School'); assert.equal(row.resolution, ''); }
  assert.equal(sql(`select count(*) from public.inventory_movements where trip_id=${lit(target.id)} and user_id=${lit(lead.id)} and quantity=0 and note like '%Reviewed packing plan%'`), '2');
  await unchanged(() => packing('approve', { ...approval, lines: [{ ...approval.lines[0], quantity: 2 }] }, lead), /different input/);
  await unchanged(() => act('pack', { manifestId: result.manifestIds[0], quantity: 1 }, student), /Start packing/);
  await resolveTarget(target);
  pass('reviewed batch approval is actor-attributed, atomic and exactly replayable, preserves owned balances, and still requires the trip packing step');

  const invalidTarget = await trip('invalid review'), foreign = await trip('foreign destination');
  const original = await line(tool.id, invalidTarget);
  const candidate = { requestId: randomUUID(), templateId: saved.id, tripId: invalidTarget.id, reviewed: true, lines: [original] };
  await unchanged(() => packing('approve', { ...candidate, reviewed: false }), /Review/);
  for (const patch of [{ quantity: 0 }, { quantity: -1 }, { quantity: 'NaN' }, { quantity: 3 }, { itemUpdatedAt: '2000-01-01' }, { balanceUpdatedAt: '' }, { homeLocationId: source.to }, { destinationId: foreign.to }])
    await unchanged(() => packing('approve', { ...candidate, lines: [{ ...original, ...patch }] }), /finite|available|Availability|non-travel|destination/);
  await unchanged(() => packing('approve', { ...candidate, lines: [{ ...original, quantity: 2 }, original] }), /Not enough/);
  await unchanged(async () => packing('approve', { ...candidate, lines: [original, { ...await line(secondTool.id, invalidTarget), destinationId: foreign.to }] }), /destination/);
  assert.equal(manifests(invalidTarget), 0);
  await json(await act('move', { itemId: tool.id, from: home.id, to: project.id, quantity: 1 }, student));
  await unchanged(() => packing('approve', candidate), /Availability changed/, ['40001']);
  await json(await act('move', { itemId: tool.id, from: project.id, to: home.id, quantity: 1 }, student));
  pass('unreviewed, stale, invalid, duplicate-overcommitted and cross-trip batches leave no partial manifests or audit rows');

  const failureTarget = await trip('atomic failure');
  const failure = { requestId: randomUUID(), templateId: saved.id, tripId: failureTarget.id, reviewed: true,
    lines: [await line(tool.id, failureTarget), await line(secondTool.id, failureTarget)] };
  sql(`create function private.synthetic_packing_failure() returns trigger language plpgsql as $$begin
    if new.trip_id=${lit(failureTarget.id)} and new.inventory_item_id=${lit(secondTool.id)} then raise exception 'Synthetic second approval failure';end if;return new;end$$;
    create trigger synthetic_packing_failure before insert on public.inventory_movements for each row execute function private.synthetic_packing_failure();`);
  try { await unchanged(() => packing('approve', failure), /Synthetic second approval failure/, ['P0001']); }
  finally { sql('drop trigger synthetic_packing_failure on public.inventory_movements;drop function private.synthetic_packing_failure()'); }
  assert.equal(manifests(failureTarget), 0);
  await json(await packing('approve', failure)); assert.equal(manifests(failureTarget), 2); await resolveTarget(failureTarget);
  pass('failure after the first approved line rolls back the whole batch and its idempotency receipt; the same operation retries safely');

  const copy = await trip('closed trip copy');
  const copyPayload = { requestId: randomUUID(), sourceTripId: source.id, tripId: copy.id, reviewed: true, lines: [await line(tool.id, copy)] };
  await unchanged(() => packing('approve', { ...copyPayload, sourceTripId: copy.id }), /Only a closed/);
  await unchanged(() => packing('approve', { ...copyPayload, templateId: saved.id }), /Choose one/);
  await json(await packing('approve', copyPayload, admin)); await resolveTarget(copy);
  await json(await act('trip_status', { tripId: copy.id, status: 'in_transit' }));
  await unchanged(() => packing('approve', { ...copyPayload, requestId: randomUUID() }, admin), /planning or packing/);
  pass('copying a closed trip requires fresh review and an eligible target, and never revives archived travel destinations');

  const retrySave = { requestId: randomUUID(), name: 'Synthetic concurrent kit save', sourceTripId: source.id };
  const saves = await Promise.all([packing('save', retrySave, admin), packing('save', retrySave, admin)]);
  assert.deepEqual(await json(saves[0]), await json(saves[1]));
  assert.equal(sql("select count(*) from public.packing_templates where name='Synthetic concurrent kit save'"), '1');
  const actorScoped = await json(await packing('save', retrySave, mentor));
  assert.notEqual(actorScoped.id, sql(`select id from public.packing_templates where name='Synthetic concurrent kit save' and created_by=${lit(admin.id)}`));
  const duplicateTarget = await trip('concurrent duplicate approval');
  const duplicate = { requestId: randomUUID(), templateId: saved.id, tripId: duplicateTarget.id, reviewed: true, lines: [await line(tool.id, duplicateTarget, 2)] };
  const repeats = await Promise.all([packing('approve', duplicate, lead), packing('approve', duplicate, lead)]);
  assert.deepEqual(await json(repeats[0]), await json(repeats[1])); assert.equal(manifests(duplicateTarget), 1); await resolveTarget(duplicateTarget);
  const competingTargets = [await trip('competing plan one'), await trip('competing plan two')];
  const payloads = await Promise.all(competingTargets.map(async t => ({ requestId: randomUUID(), templateId: saved.id, tripId: t.id, reviewed: true, lines: [await line(tool.id, t, 2)] })));
  const responses = await Promise.all(payloads.map(payload => packing('approve', payload, lead)));
  assert.equal(responses.filter(response => response.ok).length, 1); await json(responses.find(response => response.ok));
  await denied(responses.find(response => !response.ok), /Not enough available/);
  assert.equal(competingTargets.reduce((sum, t) => sum + manifests(t), 0), 1);
  for (const t of competingTargets) await resolveTarget(t);
  pass('parallel HTTP duplicate saves/approvals commit once; actor-scoped receipt IDs stay independent; competing trips cannot reserve the same stock twice');

  sql(`update public.profiles set active=false where id=${lit(lead.id)}`);
  await unchanged(() => packing('save', { ...save, requestId: randomUUID() }, lead), /lead, admin or mentor/, ['42501']);
  assert.deepEqual(await json(await get(`packing_templates?id=eq.${saved.id}`, lead)), []);
  pass('revoking a current profile blocks its already-issued real Auth token from saving or reading templates');
  return checks;
}
