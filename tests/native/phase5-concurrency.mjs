#!/usr/bin/env node
// Native PostgreSQL sessions and observed lock waits. This suite additionally
// installs phase 4 for the checkout-versus-reviewed-packing reservation boundary.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withNativePhase } from '../integration/phase3-native-support.mjs';
import { phase4Migration, phase4SourceFiles } from '../integration/phase4-templates.mjs';
import { phase5Migration, phase5SourceFiles } from '../integration/phase5-checkouts.mjs';
import { lit, area } from '../integration/phase3-test-support.mjs';
try {
  await withNativePhase(5, { migrations: [phase4Migration, phase5Migration], sourceFiles: [...phase4SourceFiles, ...phase5SourceFiles, 'tests/native/phase5-concurrency.mjs'], run: async ctx => {
    const { sql, last, actor, users, read, gate, blocked, asyncSQL, oneWinner, pass } = ctx;
    const home = randomUUID(), project = randomUUID(), other = randomUUID();
    sql(`${actor('mentor')}insert into public.locations(id,name,location_type) values(${lit(home)},'Synthetic custody home','Drawer'),(${lit(project)},'Synthetic custody project','Storage'),(${lit(other)},'Synthetic alternate project','Storage');`);
    const inventorySQL = (who, action, data) => `${actor(who)}select public.inventory_action(${lit(action)},${lit(JSON.stringify(data))}::jsonb);`;
    const act = (who, action, data) => last(sql(inventorySQL(who, action, data)));
    const toolSQL = (who, action, data) => `${actor(who)}select public.tool_checkout_action(${lit(action)},${lit(JSON.stringify(data))}::jsonb);`;
    const tool = (who, action, data) => last(sql(toolSQL(who, action, data)));
    const packSQL = (who, action, data) => `${actor(who)}select public.packing_template_action(${lit(action)},${lit(JSON.stringify(data))}::jsonb);`;
    const item = (quantity = 2) => {
      const id = randomUUID(); sql(`${actor('mentor')}insert into public.inventory_items(id,name,area_id,category,item_type,ownership,quantity,location_id)
        values(${lit(id)},'Synthetic concurrent custody tool',${lit(area)},'Synthetic','Tool','Shared / School',${quantity},${lit(home)})`); return id;
    };
    const checkout = (id, quantity = 1, extra = {}) => ({ operationId: randomUUID(), itemId: id, from: home, to: project, quantity,
      borrower: 'Synthetic borrower', project: 'Synthetic project', expectedReturn: '2026-12-31', note: 'Synthetic concurrency fixture', ...extra });
    const loan = id => read('public.tool_loans', id);
    const returnData = (id, quantity = 1) => ({ operationId: randomUUID(), loanId: id, quantity, updatedAt: loan(id).updated_at, note: 'Synthetic return' });
    const balance = (id, location) => Number(sql(`select coalesce(sum(quantity),0) from public.inventory_balances where inventory_item_id=${lit(id)} and location_id=${lit(location)}`));
    const total = (id, expected) => {
      assert.equal(Number(read('public.inventory_items', id).quantity), expected);
      assert.equal(Number(sql(`select sum(quantity) from public.inventory_balances where inventory_item_id=${lit(id)}`)), expected);
      assert.equal(read('public.inventory_items', id).ownership, 'Shared / School');
    };
    const loans = id => Number(sql(`select count(*) from public.tool_loans where inventory_item_id=${lit(id)}`));
    const custodyState = () => sql(`select jsonb_build_object(
      'items',(select jsonb_agg(to_jsonb(t) order by id) from public.inventory_items t),
      'balances',(select jsonb_agg(to_jsonb(t) order by id) from public.inventory_balances t),
      'loans',(select jsonb_agg(to_jsonb(t) order by id) from public.tool_loans t),
      'movements',(select jsonb_agg(to_jsonb(t) order by id) from public.inventory_movements t),
      'events',(select jsonb_agg(to_jsonb(t) order by id) from public.inventory_events t),
      'receipts',(select jsonb_agg(to_jsonb(t) order by id) from private.tool_checkout_operations t))`);
    const itemGate = (name, id) => gate(name, `select id from public.inventory_items where id=${lit(id)} for update`);
    const trip = () => { const { id } = act('mentor', 'create_trip', { name: 'Synthetic concurrent custody trip' }); return { id, to: sql(`select id from public.locations where trip_id=${lit(id)} and name='Trailer'`) }; };

    let id = item(), payload = checkout(id, 2), release = await itemGate('checkout-repeat-gate', id);
    let pair = Promise.allSettled([asyncSQL(toolSQL('student', 'checkout', payload), 'checkout-repeat-one'), asyncSQL(toolSQL('student', 'checkout', payload), 'checkout-repeat-two')]);
    await blocked('checkout-repeat-one', 'checkout-repeat-two'); await release(); let results = await pair;
    assert(results.every(result => result.status === 'fulfilled')); assert.equal(last(results[0].value).id, last(results[1].value).id);
    assert.equal(loans(id), 1); assert.equal(balance(id, home), 0); assert.equal(balance(id, project), 2); total(id, 2);
    assert.equal(sql(`select count(*) from private.tool_checkout_operations where id=${lit(payload.operationId)}`), '1');
    pass('identical checkout requests block in distinct sessions and commit one durable loan/movement without changing owned total');

    id = item(); release = await itemGate('checkout-competing-gate', id);
    pair = Promise.allSettled([asyncSQL(toolSQL('student', 'checkout', checkout(id, 2)), 'checkout-competing-one'), asyncSQL(toolSQL('counter', 'checkout', checkout(id, 2)), 'checkout-competing-two')]);
    await blocked('checkout-competing-one', 'checkout-competing-two'); await release(); results = await pair; oneWinner(results, /Not enough available/);
    assert.equal(loans(id), 1); assert.equal(balance(id, project), 2); total(id, 2);
    pass('different borrowers competing for the same unreserved source quantity produce one checkout');

    id = item(); release = await itemGate('checkout-move-gate', id);
    pair = Promise.allSettled([asyncSQL(toolSQL('student', 'checkout', checkout(id, 2)), 'checkout-v-move'),
      asyncSQL(inventorySQL('counter', 'move', { itemId: id, from: home, to: other, quantity: 2 }), 'move-v-checkout')]);
    await blocked('checkout-v-move', 'move-v-checkout'); await release(); results = await pair; oneWinner(results, /Not enough/);
    assert.equal(balance(id, home), 0); assert.equal(balance(id, project) + balance(id, other), 2);
    assert.equal(loans(id), results[0].status === 'fulfilled' ? 1 : 0); total(id, 2);
    pass('a simultaneous ordinary stock move and checkout serialize on the same item and cannot double-spend physical stock');

    id = item(); let lid = tool('student', 'checkout', checkout(id, 2)).id;
    const returns = [returnData(lid), returnData(lid)]; release = await itemGate('return-version-gate', id);
    pair = Promise.allSettled(returns.map((p, index) => asyncSQL(toolSQL('student', 'return', p), `return-version-${index}`)));
    await blocked('return-version-0', 'return-version-1'); await release(); results = await pair; oneWinner(results, /changed/);
    assert.equal(loan(lid).returned_quantity, 1); assert.equal(balance(id, home), 1); assert.equal(balance(id, project), 1); total(id, 2);
    const final = returnData(lid); release = await itemGate('return-final-gate', id);
    pair = Promise.allSettled([asyncSQL(toolSQL('student', 'return', final), 'return-final-one'), asyncSQL(toolSQL('student', 'return', final), 'return-final-two')]);
    await blocked('return-final-one', 'return-final-two'); await release(); results = await pair;
    assert(results.every(result => result.status === 'fulfilled')); assert.equal(loan(lid).status, 'returned'); assert.equal(balance(id, home), 2); total(id, 2);
    assert.equal(sql(`select count(*) from public.inventory_movements where inventory_item_id=${lit(id)} and movement_type='tool_return'`), '2');
    pass('different return operations cannot both spend the same loan version; identical final returns remain idempotent after the loan is closed');

    id = item(3); const a = tool('student', 'checkout', checkout(id)).id, b = tool('counter', 'checkout', checkout(id)).id, c = tool('lead', 'checkout', checkout(id)).id;
    release = await itemGate('separate-loan-gate', id);
    pair = Promise.allSettled([asyncSQL(toolSQL('student', 'return', returnData(a)), 'separate-loan-one'), asyncSQL(toolSQL('counter', 'return', returnData(b)), 'separate-loan-two')]);
    await blocked('separate-loan-one', 'separate-loan-two'); await release(); results = await pair;
    assert(results.every(result => result.status === 'fulfilled')); assert.equal(loan(a).status, 'returned'); assert.equal(loan(b).status, 'returned');
    assert.equal(loan(c).status, 'out'); assert.equal(loan(c).returned_quantity, 0); assert.equal(balance(id, project), 1); total(id, 3);
    pass('concurrent returns of independent borrower claims preserve the third loan and exact physical ownership totals');

    id = item(3); tool('student', 'checkout', checkout(id, 2)); act('student', 'move', { itemId: id, from: home, to: project, quantity: 1 });
    const targets = [trip(), trip()]; release = await itemGate('custody-approval-gate', id);
    pair = Promise.allSettled(targets.map((t, index) => asyncSQL(inventorySQL('lead', 'approve', { tripId: t.id, itemId: id, from: project, to: t.to, quantity: 1 }), `custody-approval-${index}`)));
    await blocked('custody-approval-0', 'custody-approval-1'); await release(); results = await pair; oneWinner(results, /Outstanding tool loans/);
    assert.equal(Number(sql(`select sum(quantity) from public.trip_manifest_items where inventory_item_id=${lit(id)} and status='approved'`)), 1); total(id, 3);
    assert.throws(() => act('student', 'move', { itemId: id, from: project, to: home, quantity: 2 }), /Outstanding tool loans/);
    pass('competing trip approvals share only the unclaimed quantity at a checkout destination and cannot allocate another borrower’s reserved tools');

    id = item(); const source = trip(); const sourceApproval = act('mentor', 'approve', { tripId: source.id, itemId: id, from: home, to: source.to, quantity: 2 });
    act('mentor', 'resolve', { manifestId: sourceApproval.id, quantity: 2, note: 'Synthetic planned source' });
    act('mentor', 'trip_status', { tripId: source.id, status: 'closed' });
    const template = last(sql(packSQL('mentor', 'save', { requestId: randomUUID(), name: 'Synthetic checkout comparison kit', sourceTripId: source.id }))).id;
    const target = trip(); const reviewed = { requestId: randomUUID(), templateId: template, tripId: target.id, reviewed: true,
      lines: [{ itemId: id, quantity: 2, homeLocationId: home, destinationId: target.to,
        itemUpdatedAt: read('public.inventory_items', id).updated_at,
        balanceUpdatedAt: sql(`select updated_at from public.inventory_balances where inventory_item_id=${lit(id)} and location_id=${lit(home)}`) }] };
    release = await itemGate('checkout-template-gate', id);
    pair = Promise.allSettled([asyncSQL(toolSQL('student', 'checkout', checkout(id, 2)), 'checkout-v-template'), asyncSQL(packSQL('lead', 'approve', reviewed), 'template-v-checkout')]);
    await blocked('checkout-v-template', 'template-v-checkout'); await release(); results = await pair; oneWinner(results, /Not enough available|Availability changed/);
    assert.equal(loans(id), results[0].status === 'fulfilled' ? 1 : 0);
    assert.equal(Number(sql(`select count(*) from public.trip_manifest_items where trip_id=${lit(target.id)}`)), results[1].status === 'fulfilled' ? 1 : 0); total(id, 2);
    pass('checkout and reviewed template approval competing for one source commit one reservation path, preserving the shared phase 4/5 availability boundary');

    id = item(); lid = tool('student', 'checkout', checkout(id, 2)).id;
    const beforeLoan = loan(lid), beforeState = custodyState();
    const missing = { operationId: randomUUID(), loanId: lid, updatedAt: beforeLoan.updated_at, note: 'Synthetic queued missing report' };
    release = await itemGate('tool-revocation-gate', id); const revoked = asyncSQL(toolSQL('student', 'mark_missing', missing), 'revoked-missing-report');
    await blocked('revoked-missing-report'); sql(`update public.profiles set active=false where id=${lit(users.student)}`); await release();
    await assert.rejects(revoked, /permission|active/i); assert.deepEqual(loan(lid), beforeLoan);
    assert.equal(custodyState(), beforeState);
    assert.equal(sql(`select count(*) from private.tool_checkout_operations where id=${lit(missing.operationId)}`), '0');
    pass('profile revocation while a status action waits blocks loan status, history and durable receipt changes');

    async function revokedAt(name, lock, action, data) {
      sql(`update public.profiles set active=true where id=${lit(users.student)}`);
      const before = custodyState(), unlock = await gate(`${name}-gate`, lock);
      const waiting = asyncSQL(toolSQL('student', action, data), name);
      await blocked(name); sql(`update public.profiles set active=false where id=${lit(users.student)}`); await unlock();
      await assert.rejects(waiting, /permission|active/i); assert.equal(custodyState(), before);
      sql(`update public.profiles set active=true where id=${lit(users.student)}`);
    }
    sql(`update public.profiles set active=true where id=${lit(users.student)}`);
    id = item(); payload = checkout(id);
    const operationLock = op => `select pg_advisory_xact_lock(hashtextextended(${lit(op)},441805))`;
    await revokedAt('revoked-new-operation', operationLock(payload.operationId), 'checkout', payload);
    assert.equal(loans(id), 0);
    tool('student', 'checkout', payload);
    await revokedAt('revoked-operation-replay', operationLock(payload.operationId), 'checkout', payload);
    assert.equal(loans(id), 1);
    pass('revocation behind the operation advisory lock denies both new checkout and already-recorded replay without changing stock, history or receipts');

    id = item(); lid = tool('student', 'checkout', checkout(id, 2)).id;
    tool('student', 'mark_missing', { operationId: randomUUID(), loanId: lid, updatedAt: loan(lid).updated_at, note: 'Synthetic missing before queued found' });
    const found = { operationId: randomUUID(), loanId: lid, updatedAt: loan(lid).updated_at, note: 'Synthetic found while queued' };
    await revokedAt('revoked-loan-row', `select id from public.tool_loans where id=${lit(lid)} for update`, 'mark_found', found);
    assert.equal(loan(lid).status, 'missing');
    pass('revocation behind the loan row lock prevents mark-found status, movement history and receipt changes');

    const returning = returnData(lid, 2);
    await revokedAt('revoked-location-return', `select pg_advisory_xact_lock(hashtextextended(${lit([home, project].sort()[0])},4418))`, 'return', returning);
    assert.equal(loan(lid).returned_quantity, 0); assert.equal(balance(id, project), 2); total(id, 2);
    pass('revocation behind the location advisory lock rolls back the queued return and preserves custody, physical balances, history and receipts');
  } });
} catch (error) { console.error(error.message); process.exitCode = 1; }
