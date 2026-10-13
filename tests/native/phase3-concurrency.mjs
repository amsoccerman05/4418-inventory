#!/usr/bin/env node
// Native sessions prove actual blocking/serialization. The real Auth module is
// tests/integration/phase3-restock.mjs; this synthetic identity shim is separate.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withNativePhase } from '../integration/phase3-native-support.mjs';
import { phase3Migration, phase3SourceFiles, installPhase3Prerequisites } from '../integration/phase3-sources.mjs';
import { lit, area } from '../integration/phase3-test-support.mjs';

try {
  await withNativePhase(3, { prepare: installPhase3Prerequisites, migrations: [phase3Migration], sourceFiles: [...phase3SourceFiles, 'tests/native/phase3-concurrency.mjs'], run: async ctx => {
    const { sql, last, actor, users, read, gate, blocked, asyncSQL, oneWinner, pass } = ctx;
    const home = randomUUID(), project = randomUUID();
    sql(`${actor('mentor')}insert into public.locations(id,name,location_type) values(${lit(home)},'Synthetic restock home','Drawer'),(${lit(project)},'Synthetic receiving','Storage');`);
    sql(`insert into public.team_positions(key,name) values('finance_lead','Synthetic Finance'),('lead_coach_1','Synthetic Coach');
      insert into public.team_member_positions(user_id,position_key) values(${lit(users.finance)},'finance_lead'),(${lit(users.coach)},'lead_coach_1');`);
    const raw = id => read('inventory_purchasing.requests', id);
    const stock = id => Number(sql(`select quantity from public.inventory_items where id=${lit(id)}`));
    const receiptCount = id => Number(sql(`select count(*) from inventory_purchasing.receipts where request_id=${lit(id)}`));
    const actionSQL = (who, action, p) => `${actor(who)}select public.inventory_purchasing_action(${lit(action)},${lit(JSON.stringify(p))}::jsonb);`;
    const act = (who, action, p) => last(sql(actionSQL(who, action, p)));
    const financeSQL = (who, action, id, extra = {}) => `${actor(who)}select public.finance_mutate(${lit(action)},${lit(JSON.stringify({ id, version: read('public.finance_purchase_orders', id).version, ...extra }))}::jsonb);`;
    const finance = (who, action, id, extra = {}) => sql(financeSQL(who, action, id, extra));
    const order = id => ({ request_id: id, version: raw(id).version, reference: 'SYNTHETIC-NATIVE' });
    const receipt = (id, quantity, extra = {}) => ({ id: randomUUID(), request_id: id, version: raw(id).version, quantity,
      location_id: home, delivery_reference: randomUUID(), note: 'Synthetic concurrent receipt', ...extra });
    const create = ({ approvedOnly = false } = {}) => {
      const item = randomUUID(), id = randomUUID();
      sql(`${actor('mentor')}insert into public.inventory_items(id,name,area_id,category,quantity,unit,location_id)
        values(${lit(item)},'Synthetic concurrency restock',${lit(area)},'Synthetic',3,'ft',${lit(home)});`);
      act('mentor', 'configure', { item_id: item, version: 0, supplier: 'Synthetic Supplier', purchase_unit: 'box', units_per_pack: 12.5, pack_cost: 20 });
      act('student', 'request', { id, item_id: item, packs: 2, settings_version: 1, note: 'Synthetic restock' });
      act('student', 'create_po', { request_id: id, version: 1, sheet_url: 'https://docs.google.com/spreadsheets/d/synthetic-test', amount: 60 });
      const po = raw(id).po_id;
      finance('student', 'submit', po); finance('finance', 'approve', po, { slot: 'finance_approver' }); finance('coach', 'approve', po, { slot: 'po_approver' });
      if (!approvedOnly) { finance('mentor', 'school_submit', po); act('mentor', 'record_order', order(id)); }
      return { item, id, po };
    };
    const lock = name => gate(name, 'select pg_advisory_xact_lock(4418,20)');
    const assertTotal = item => assert.equal(Number(sql(`select sum(quantity) from public.inventory_balances where inventory_item_id=${lit(item)}`)), stock(item));

    let fixture = create(); let release = await lock('receipt-remaining-gate');
    let resultsPromise = Promise.allSettled([asyncSQL(actionSQL('counter', 'receive', receipt(fixture.id, 15)), 'receipt-one'), asyncSQL(actionSQL('counter', 'receive', receipt(fixture.id, 15)), 'receipt-two')]);
    await blocked('receipt-one', 'receipt-two'); await release(); let results = await resultsPromise;
    oneWinner(results, /changed/); assert.equal(receiptCount(fixture.id), 1); assert.equal(stock(fixture.item), 18); assert.equal(Number(raw(fixture.id).received), 15); assertTotal(fixture.item);
    assert.throws(() => act('counter', 'receive', receipt(fixture.id, 15)), /no greater/);
    pass('two separate receipt sessions block on the Finance lock; only one version commits and a refreshed loser cannot overreceive');

    const same = receipt(fixture.id, 10); release = await lock('final-retry-gate');
    resultsPromise = Promise.allSettled([asyncSQL(actionSQL('counter', 'receive', same), 'final-retry-one'), asyncSQL(actionSQL('counter', 'receive', same), 'final-retry-two')]);
    await blocked('final-retry-one', 'final-retry-two'); await release(); results = await resultsPromise;
    assert(results.every(result => result.status === 'fulfilled')); assert.equal(receiptCount(fixture.id), 2); assert.equal(stock(fixture.item), 28); assert.equal(raw(fixture.id).state, 'received'); assertTotal(fixture.item);
    assert.equal(sql(`select count(*) from public.inventory_movements where inventory_item_id=${lit(fixture.item)} and note like 'Restock receipt %'`), '2');
    pass('simultaneous identical final receipt retries both resolve, commit one delivery and preserve exact stock/balance totals');

    fixture = create(); const first = receipt(fixture.id, 5, { delivery_reference: ' Delivery-Key ' });
    const second = receipt(fixture.id, 5, { delivery_reference: 'delivery-key' });
    release = await lock('delivery-key-gate');
    resultsPromise = Promise.allSettled([asyncSQL(actionSQL('counter', 'receive', first), 'delivery-key-one'), asyncSQL(actionSQL('counter', 'receive', second), 'delivery-key-two')]);
    await blocked('delivery-key-one', 'delivery-key-two'); await release(); results = await resultsPromise; oneWinner(results, /changed/);
    const losing = results[0].status === 'rejected' ? first : second;
    assert.throws(() => act('counter', 'receive', { ...losing, version: raw(fixture.id).version }), /already been received/);
    assert.equal(receiptCount(fixture.id), 1); assert.equal(stock(fixture.item), 8);
    pass('different operation IDs for the same normalized delivery cannot double-count, including the loser refreshed after the race');

    fixture = create(); const beforeRequest = raw(fixture.id);
    release = await lock('receipt-revocation-gate'); const revoked = asyncSQL(actionSQL('counter', 'receive', receipt(fixture.id, 5)), 'revoked-receipt');
    await blocked('revoked-receipt'); sql(`update public.profiles set active=false where id=${lit(users.counter)}`); await release();
    await assert.rejects(revoked, /write access/); assert.deepEqual(raw(fixture.id), beforeRequest); assert.equal(receiptCount(fixture.id), 0); assert.equal(stock(fixture.item), 3);
    sql(`update public.profiles set active=true where id=${lit(users.counter)}`);
    pass('a current-profile revocation committed while receiving is blocked prevents the queued stock mutation');

    fixture = create(); release = await gate('receipt-unit-gate', `select id from public.inventory_items where id=${lit(fixture.item)} for update`);
    const unitChanged = asyncSQL(actionSQL('counter', 'receive', receipt(fixture.id, 5)), 'unit-changed-receipt');
    await blocked('unit-changed-receipt'); await release(`${actor('mentor')}update public.inventory_items set unit='box' where id=${lit(fixture.item)};`);
    await assert.rejects(unitChanged, /stock unit changed/); assert.equal(receiptCount(fixture.id), 0); assert.equal(stock(fixture.item), 3);
    pass('a stock-unit change while receiving waits invalidates the recorded purchase conversion without a partial stock write');

    fixture = create({ approvedOnly: true }); release = await lock('order-revision-gate');
    const staleOrder = asyncSQL(actionSQL('mentor', 'record_order', order(fixture.id)), 'stale-order');
    await blocked('stale-order');
    const edit = { id: fixture.po, version: read('public.finance_purchase_orders', fixture.po).version, area_id: area,
      sheet_url: 'https://docs.google.com/spreadsheets/d/synthetic-test', vendor: 'Synthetic Supplier', amount: 60, purpose: 'Synthetic edited revision' };
    await release(`${actor('student')}select public.finance_mutate('edit',${lit(JSON.stringify(edit))}::jsonb);
      select public.finance_mutate('submit',jsonb_build_object('id',${lit(fixture.po)},'version',(select version from public.finance_purchase_orders where id=${lit(fixture.po)})));`);
    await assert.rejects(staleOrder, /Both current/); assert.equal(read('public.finance_purchase_orders', fixture.po).revision, 2);
    assert.equal(raw(fixture.id).state, 'po_linked'); assert.equal(stock(fixture.item), 3);
    pass('Finance edit/resubmission committed ahead of a waiting order invalidates both old approvals and leaves Inventory unreceived');

    fixture = create(); const close = { request_id: fixture.id, version: raw(fixture.id).version, note: 'Synthetic supplier shortfall' };
    release = await lock('receipt-close-gate');
    resultsPromise = Promise.allSettled([asyncSQL(actionSQL('counter', 'receive', receipt(fixture.id, 5)), 'close-v-receipt'), asyncSQL(actionSQL('mentor', 'close_short', close), 'receipt-v-close')]);
    await blocked('close-v-receipt', 'receipt-v-close'); await release(); results = await resultsPromise; oneWinner(results, /changed/);
    const request = raw(fixture.id); assert(['partial', 'closed_short'].includes(request.state));
    assert.equal(stock(fixture.item), request.state === 'partial' ? 8 : 3); assert.equal(receiptCount(fixture.id), request.state === 'partial' ? 1 : 0); assertTotal(fixture.item);
    pass('closing the unreceived remainder concurrent with a receipt commits one state transition and preserves any received stock');
  } });
} catch (error) { console.error(error.message); process.exitCode = 1; }
