#!/usr/bin/env node
// True PostgreSQL concurrency with deterministic row/advisory lock gates.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withNativePhase } from '../integration/phase3-native-support.mjs';
import { phase4Migration, phase4SourceFiles } from '../integration/phase4-templates.mjs';
import { lit, area } from '../integration/phase3-test-support.mjs';
try {
  await withNativePhase(4, { migrations: [phase4Migration], sourceFiles: [...phase4SourceFiles, 'tests/native/phase4-concurrency.mjs'], run: async ctx => {
    const { sql, last, actor, users, read, gate, blocked, asyncSQL, oneWinner, pass } = ctx;
    const home = randomUUID(), project = randomUUID();
    sql(`${actor('mentor')}insert into public.locations(id,name,location_type) values(${lit(home)},'Synthetic template home','Drawer'),(${lit(project)},'Synthetic template project','Storage');`);
    const inventorySQL = (who, action, data) => `${actor(who)}select public.inventory_action(${lit(action)},${lit(JSON.stringify(data))}::jsonb);`;
    const act = (who, action, data) => last(sql(inventorySQL(who, action, data)));
    const packingSQL = (who, action, data) => `${actor(who)}select public.packing_template_action(${lit(action)},${lit(JSON.stringify(data))}::jsonb);`;
    const pack = (who, action, data) => last(sql(packingSQL(who, action, data)));
    const trip = () => { const { id } = act('mentor', 'create_trip', { name: 'Synthetic concurrent packing trip' }); return { id, to: sql(`select id from public.locations where trip_id=${lit(id)} and name='Trailer'`) }; };
    const newItem = () => {
      const id = randomUUID(); sql(`${actor('mentor')}insert into public.inventory_items(id,name,area_id,category,item_type,ownership,quantity,location_id)
        values(${lit(id)},'Synthetic concurrency kit tool',${lit(area)},'Synthetic','Tool','Shared / School',2,${lit(home)})`); return id;
    };
    const line = (id, target, quantity = 1) => ({ itemId: id, quantity, homeLocationId: home, destinationId: target.to,
      itemUpdatedAt: read('public.inventory_items', id).updated_at,
      balanceUpdatedAt: sql(`select updated_at from public.inventory_balances where inventory_item_id=${lit(id)} and location_id=${lit(home)}`) });
    const fixture = () => {
      const items = [newItem(), newItem()], source = trip();
      for (const item of items) {
        const { id } = act('mentor', 'approve', { tripId: source.id, itemId: item, from: home, to: source.to, quantity: 2 });
        act('mentor', 'resolve', { manifestId: id, quantity: 2, note: 'Synthetic plan only source' });
      }
      act('mentor', 'trip_status', { tripId: source.id, status: 'closed' });
      const template = pack('mentor', 'save', { requestId: randomUUID(), name: 'Synthetic native template', sourceTripId: source.id }).id;
      return { items, source, template };
    };
    const approve = (fixture, target, items = fixture.items, quantity = 1) => ({ requestId: randomUUID(), templateId: fixture.template, tripId: target.id, reviewed: true, lines: items.map(id => line(id, target, quantity)) });
    const manifestCount = id => Number(sql(`select count(*) from public.trip_manifest_items where trip_id=${lit(id)}`));
    const physical = () => sql("select jsonb_build_object('items',(select jsonb_agg(to_jsonb(i) order by id) from public.inventory_items i),'balances',(select jsonb_agg(to_jsonb(b) order by id) from public.inventory_balances b))");
    const itemGate = (name, id) => gate(name, `select id from public.inventory_items where id=${lit(id)} for update`);

    let f = fixture(); const saved = { requestId: randomUUID(), name: 'Synthetic concurrent save', sourceTripId: f.source.id };
    let release = await gate('template-save-gate', `select pg_advisory_xact_lock(hashtextextended(${lit(users.mentor + saved.requestId)},441804))`);
    let pair = Promise.allSettled([asyncSQL(packingSQL('mentor', 'save', saved), 'template-save-one'), asyncSQL(packingSQL('mentor', 'save', saved), 'template-save-two')]);
    await blocked('template-save-one', 'template-save-two'); const before = physical(); await release(); let results = await pair;
    assert(results.every(result => result.status === 'fulfilled')); assert.deepEqual(last(results[0].value), last(results[1].value)); assert.equal(physical(), before);
    assert.equal(sql("select count(*) from public.packing_templates where name='Synthetic concurrent save'"), '1');
    assert.equal(sql(`select count(*) from private.packing_template_requests where actor_id=${lit(users.mentor)} and request_id=${lit(saved.requestId)}`), '1');
    pass('identical saves block on the same operation lock, then return one durable template receipt without physical changes');

    let target = trip(), payload = approve(f, target);
    release = await gate('template-approve-gate', `select id from public.trips where id=${lit(target.id)} for update`);
    pair = Promise.allSettled([asyncSQL(packingSQL('lead', 'approve', payload), 'template-approve-one'), asyncSQL(packingSQL('lead', 'approve', payload), 'template-approve-two')]);
    await blocked('template-approve-one', 'template-approve-two'); const beforeApprove = physical(); await release(); results = await pair;
    assert(results.every(result => result.status === 'fulfilled')); assert.deepEqual(last(results[0].value), last(results[1].value));
    assert.equal(manifestCount(target.id), 2); assert.equal(physical(), beforeApprove);
    pass('same-operation approvals blocked behind the target trip commit one atomic batch and return the same manifest IDs');

    f = fixture(); const targets = [trip(), trip()];
    const requests = targets.map(t => approve(f, t, [f.items[0]], 2));
    release = await itemGate('competing-kit-gate', f.items[0]);
    pair = Promise.allSettled(requests.map((p, index) => asyncSQL(packingSQL('lead', 'approve', p), `competing-kit-${index}`)));
    await blocked('competing-kit-0', 'competing-kit-1'); await release(); results = await pair; oneWinner(results, /Not enough available/);
    assert.equal(targets.reduce((sum, t) => sum + manifestCount(t.id), 0), 1);
    assert.equal(Number(sql(`select sum(quantity) from public.trip_manifest_items where inventory_item_id=${lit(f.items[0])} and status='approved'`)), 2);
    pass('different trip rows cannot hide competing reservations; the shared item lock allows one reviewed plan for the available stock');

    f = fixture(); target = trip(); payload = approve(f, target, [f.items[0]]);
    release = await itemGate('stale-kit-gate', f.items[0]); const stale = asyncSQL(packingSQL('lead', 'approve', payload), 'stale-kit-approval');
    await blocked('stale-kit-approval'); await release(inventorySQL('student', 'move', { itemId: f.items[0], from: home, to: project, quantity: 1 }));
    await assert.rejects(stale, /Availability changed/); assert.equal(manifestCount(target.id), 0);
    assert.equal(sql(`select count(*) from private.packing_template_requests where actor_id=${lit(users.lead)} and request_id=${lit(payload.requestId)}`), '0');
    assert.equal(Number(sql(`select quantity from public.inventory_balances where inventory_item_id=${lit(f.items[0])} and location_id=${lit(project)}`)), 1);
    pass('a physical move committed while approval waits invalidates review versions and rolls back every manifest/operation receipt');

    f = fixture(); const twoTargets = [trip(), trip()];
    const reversed = [approve(f, twoTargets[0]), approve(f, twoTargets[1], [...f.items].reverse())];
    release = await itemGate('reversed-kit-gate', [...f.items].sort()[0]);
    pair = Promise.allSettled(reversed.map((p, index) => asyncSQL(packingSQL('lead', 'approve', p), `reversed-kit-${index}`)));
    await blocked('reversed-kit-0', 'reversed-kit-1'); await release(); results = await pair;
    assert(results.every(result => result.status === 'fulfilled'), results.map(result => result.reason?.message).join('; '));
    for (const t of twoTargets) assert.equal(manifestCount(t.id), 2);
    for (const item of f.items) assert.equal(Number(sql(`select sum(quantity) from public.trip_manifest_items where inventory_item_id=${lit(item)} and status='approved'`)), 2);
    pass('oppositely ordered multi-item kits serialize in deterministic item order without deadlock or over-reservation');

    f = fixture(); target = trip(); payload = approve(f, target);
    release = await gate('archived-target-gate', `select id from public.trips where id=${lit(target.id)} for update`);
    const archived = asyncSQL(packingSQL('lead', 'approve', payload), 'archived-target-approval');
    await blocked('archived-target-approval'); await release(inventorySQL('mentor', 'trip_status', { tripId: target.id, status: 'closed' }));
    await assert.rejects(archived, /planning or packing/); assert.equal(manifestCount(target.id), 0);
    pass('a trip closed while approval waits is re-read after the lock and cannot receive new allocations');

    f = fixture(); const revocationPayload = { requestId: randomUUID(), name: 'Synthetic revoked queued save', sourceTripId: f.source.id };
    release = await gate('template-revocation-gate', `select id from public.trips where id=${lit(f.source.id)} for update`);
    const revoked = asyncSQL(packingSQL('lead', 'save', revocationPayload), 'revoked-template-save');
    await blocked('revoked-template-save'); sql(`update public.profiles set active=false where id=${lit(users.lead)}`); await release();
    await assert.rejects(revoked, /permission|lead, admin or mentor|active/i);
    assert.equal(sql(`select count(*) from private.packing_template_requests where actor_id=${lit(users.lead)} and request_id=${lit(revocationPayload.requestId)}`), '0');
    assert.equal(sql("select count(*) from public.packing_templates where name='Synthetic revoked queued save'"), '0');
    pass('revoking the active role while save waits blocks both template persistence and its receipt');
  } });
} catch (error) { console.error(error.message); process.exitCode = 1; }
