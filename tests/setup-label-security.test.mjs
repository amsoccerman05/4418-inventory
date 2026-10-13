import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';

// Independent migration/authorization regression suite. No live project or credentials are used.
const db = new PGlite();
const migration = '20261012232840_inventory_setup_location_labels.sql';
const area = '44180000-0000-4000-8000-000000000001';
const otherArea = '44180000-0000-4000-8000-000000000002';
const home = '10000000-0000-4000-8000-000000000011';
const otherLocation = '10000000-0000-4000-8000-000000000012';
const legacyZero = '20000000-0000-4000-8000-000000000011';
const legacyThreshold = '20000000-0000-4000-8000-000000000012';
const users = Object.fromEntries(['mentor', 'admin', 'student', 'lead', 'otherLead', 'readonly', 'inactive'].map((who, i) =>
  [who, `00000000-0000-4000-8000-${String(i + 11).padStart(12, '0')}`]));
const asUser = (who, fn) => db.transaction(async tx => {
  await tx.exec('set local role authenticated');
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [users[who]]);
  return fn(tx);
});
const row = async (id, tx = db) => (await tx.query('select to_jsonb(i) as item from public.inventory_items i where id=$1', [id])).rows[0].item;
const setup = (who, item, policy, minimum, target) => asUser(who, tx => tx.query(
  'select public.setup_inventory_item($1,$2,$3,$4,$5) as result', [item.id, item.updated_at, policy, minimum, target]));
const apply = (who, changes) => asUser(who, tx => tx.query('select public.apply_inventory_changes($1)', [JSON.stringify(changes)]));
const snapshot = async (legacyColumns = false) => {
  const tables = ['inventory_items', 'locations', 'inventory_balances', 'inventory_events', 'inventory_movements', 'trips', 'trip_manifest_items', 'profiles', 'areas'];
  const values = {};
  for (const name of tables) values[name] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(t)${legacyColumns ? " - 'restock_policy' - 'label_code'" : ''} order by id),'[]'::jsonb) as value from public.${name} t`)).rows[0].value;
  return values;
};
const defaults = async () => (await db.query(`select table_name,column_name,column_default,is_nullable
 from information_schema.columns where table_schema='public' and table_name in ('locations','inventory_items')
 and column_name not in ('restock_policy','label_code') order by table_name,column_name`)).rows;
const newItem = async (overrides = {}, who = 'mentor') => (await asUser(who, tx => tx.query(`
 insert into public.inventory_items(name,area_id,category,location_id,quantity,expected_quantity,minimum_quantity,target_quantity,restock_policy)
 values($1,$2,'Hardware',$3,$4,$5,$6,$7,$8) returning to_jsonb(inventory_items) as item`, [
 overrides.name ?? 'Setup test item', overrides.area_id ?? area, home, overrides.quantity ?? 3,
 overrides.expected_quantity ?? 8, overrides.minimum_quantity ?? 0, overrides.target_quantity ?? 0, overrides.restock_policy ?? 'unset'
 ]))).rows[0].item;
let beforeMigration, beforeDefaults;

before(async () => {
  await db.exec(`create role anon; create role authenticated;
 create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const [who, id] of Object.entries(users)) await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${who}@example.test`]);
  for (const file of ['001_initial_schema.sql', '002_rls_policies.sql', '003_operations_and_seed.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  for (const [who, id] of Object.entries(users)) await db.query('update public.profiles set role=$1,primary_area_id=$2,active=$3 where id=$4', [
    who === 'otherLead' ? 'lead' : who === 'inactive' ? 'admin' : who,
    who === 'lead' ? area : who === 'otherLead' ? otherArea : null,
    who !== 'inactive', id
  ]);
  await asUser('mentor', async tx => {
    await tx.query("insert into public.locations(id,name,location_type) values($1,'Legacy drawer','Drawer'),($2,'Other shelf','Shelf')", [home, otherLocation]);
    await tx.query(`insert into public.inventory_items(id,name,area_id,category,location_id,quantity,expected_quantity,minimum_quantity,target_quantity,last_verified_at)
 values($1,'Legacy zero thresholds',$3,'Hardware',$4,7.5,null,0,0,null),
 ($2,'Legacy configured thresholds',$3,'Hardware',$4,12,15,2,5,'2025-05-06T01:02:03Z')`, [legacyZero, legacyThreshold, area, home]);
  });
  for (const file of ['004_balances_travel_media.sql', '005_private_inventory_media.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  // A real actor-attributed verification must survive migration byte-for-byte too.
  await asUser('student', tx => tx.query('select public.change_inventory_quantity($1,0,null,null,true)', [legacyThreshold]));
  beforeMigration = await snapshot(true);
  beforeDefaults = await defaults();
  await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
});
after(() => db.close());

test('migration changes only new fields; counts, verification, audit timestamps, defaults and history are identical', async () => {
  assert.deepEqual(await snapshot(true), beforeMigration);
  assert.deepEqual(await defaults(), beforeDefaults);
  assert.equal((await row(legacyZero)).restock_policy, 'unset');
  assert.equal((await row(legacyThreshold)).restock_policy, 'unset');
  assert.equal((await row(legacyZero)).last_verified_at, null);
  assert.equal((await row(legacyThreshold)).last_verified_by, users.student);
  const labels = (await db.query('select label_code from public.locations')).rows.map(r => r.label_code);
  assert.ok(labels.every(code => /^L-[0-9A-F]{12}$/.test(code)));
  assert.equal(new Set(labels).size, labels.length);
});

test('setup is explicit, metadata-only, attributed, and does not verify or adjust inventory', async () => {
  const item = await newItem();
  const balancesBefore = (await db.query('select to_jsonb(b) as balance from public.inventory_balances b where inventory_item_id=$1', [item.id])).rows;
  const saved = (await setup('lead', item, 'restock', 2, 6)).rows[0].result.item;
  assert.equal(saved.restock_policy, 'restock');
  assert.equal(saved.minimum_quantity, 2);
  assert.equal(saved.target_quantity, 6);
  assert.equal(saved.updated_by, users.lead);
  const allowed = ['restock_policy', 'minimum_quantity', 'target_quantity', 'updated_at', 'updated_by'];
  assert.deepEqual(Object.fromEntries(Object.entries(saved).filter(([key]) => !allowed.includes(key))), Object.fromEntries(Object.entries(item).filter(([key]) => !allowed.includes(key))));
  assert.deepEqual((await db.query('select to_jsonb(b) as balance from public.inventory_balances b where inventory_item_id=$1', [item.id])).rows, balancesBefore);
  const events = (await db.query('select event_type,user_id from public.inventory_events where inventory_item_id=$1 order by created_at', [item.id])).rows;
  assert.deepEqual(events, [{event_type: 'item_created', user_id: users.mentor}, {event_type: 'item_updated', user_id: users.lead}]);
  const skipped = (await setup('lead', saved, 'do_not_restock', 2, 6)).rows[0].result.item;
  assert.equal(skipped.minimum_quantity, 2);
  assert.equal(skipped.target_quantity, 6);
  assert.equal(skipped.restock_policy, 'do_not_restock');
});

test('assigned lead, admin and mentor can configure; student, other-area lead, readonly and inactive cannot', async () => {
  for (const who of ['lead', 'admin', 'mentor']) {
    const item = await newItem();
    assert.equal((await setup(who, item, 'do_not_restock', 0, 0)).rows[0].result.item.restock_policy, 'do_not_restock');
  }
  for (const who of ['student', 'otherLead', 'readonly', 'inactive']) {
    const item = await newItem();
    await assert.rejects(() => setup(who, item, 'restock', 1, 4), error => error.code === '42501');
    assert.deepEqual(await row(item.id), item);
  }
});

test('students still count and verify; policy remains protected by the existing dynamic metadata guard', async () => {
  const item = await newItem({restock_policy: 'restock', minimum_quantity: 1, target_quantity: 5});
  await assert.rejects(() => asUser('student', tx => tx.query("update public.inventory_items set restock_policy='do_not_restock' where id=$1", [item.id])), /metadata/);
  await assert.rejects(() => apply('student', {items: [{record: {id: item.id, restock_policy: 'do_not_restock'}, expected_updated_at: item.updated_at}]}), /metadata/);
  await asUser('student', tx => tx.query('select public.change_inventory_quantity($1,-1,null,null,true)', [item.id]));
  const saved = await row(item.id);
  assert.equal(saved.quantity, 2);
  assert.equal(saved.last_verified_by, users.student);
  assert.equal(saved.restock_policy, 'restock');
  assert.equal(saved.target_quantity, 5);
});

test('setup rejects stale, missing and null versions atomically without new events', async () => {
  const item = await newItem();
  await asUser('student', tx => tx.query('select public.change_inventory_quantity($1,1)', [item.id]));
  const before = await snapshot();
  await assert.rejects(() => setup('mentor', item, 'restock', 1, 8), error => error.code === '40001');
  await assert.rejects(() => setup('mentor', {...item, updated_at: null}, 'restock', 1, 8), error => error.code === '40001');
  await assert.rejects(() => setup('mentor', {...item, id: '20000000-0000-4000-8000-999999999999'}, 'restock', 1, 8), error => error.code === '40001');
  assert.deepEqual(await snapshot(), before);
});

test('malformed policies and thresholds fail through RPC and direct API, including NaN and Infinity', async () => {
  const invalid = [
    ['restock', 2, 2], ['restock', 3, 2], ['restock', 0, 0], ['restock', -1, 5],
    ['restock', null, 5], ['restock', 1, null], ['restock', 'NaN', 5], ['restock', 1, 'NaN'],
    ['restock', 'Infinity', 5], ['restock', 1, 'Infinity'], ['restock', '-Infinity', 5],
    ['do_not_restock', -1, 0], ['do_not_restock', 0, 'Infinity'], ['unset', 0, 'NaN'],
    ['unexpected', 0, 0], [null, 0, 0]
  ];
  const item = await newItem();
  for (const [policy, minimum, target] of invalid) {
    await assert.rejects(() => setup('mentor', item, policy, minimum, target), /policy|quantities|greater|constraint/);
    await assert.rejects(() => asUser('mentor', tx => tx.query('update public.inventory_items set restock_policy=$1,minimum_quantity=$2,target_quantity=$3 where id=$4', [policy, minimum, target, item.id])), /policy|quantities|greater|constraint/);
    assert.deepEqual(await row(item.id), item);
  }
  await assert.rejects(() => newItem({restock_policy: 'restock', minimum_quantity: 0, target_quantity: 0}), /greater/);
});

test('generic editor/CSV updates support policy, preserve omitted fields, and reject a whole stale or malformed batch', async () => {
  const item = await newItem();
  await apply('lead', {items: [{record: {id: item.id, restock_policy: 'restock', minimum_quantity: 2, target_quantity: 7}, expected_updated_at: item.updated_at}]});
  let saved = await row(item.id);
  assert.equal(saved.restock_policy, 'restock');
  await apply('lead', {items: [{record: {id: item.id, notes: 'Legacy payload without restock policy'}, expected_updated_at: saved.updated_at}]});
  saved = await row(item.id);
  assert.equal(saved.restock_policy, 'restock');
  assert.equal(saved.minimum_quantity, 2);
  assert.equal(saved.target_quantity, 7);
  const second = await newItem();
  const prior = await snapshot();
  await assert.rejects(() => apply('mentor', {items: [
    {record: {id: second.id, restock_policy: 'do_not_restock'}, expected_updated_at: second.updated_at},
    {record: {id: item.id, restock_policy: 'unset'}, expected_updated_at: item.updated_at}
  ]}), error => error.code === '40001');
  assert.deepEqual(await snapshot(), prior);
  await assert.rejects(() => apply('mentor', {items: [
    {record: {id: second.id, restock_policy: 'do_not_restock'}, expected_updated_at: second.updated_at},
    {record: {id: item.id, target_quantity: 0}, expected_updated_at: saved.updated_at}
  ]}), /greater/);
  assert.deepEqual(await snapshot(), prior);
  assert.equal((await row(second.id)).restock_policy, 'unset');
  await assert.rejects(() => apply('mentor', {items: [{record: {id: item.id, restock_policy: null}, expected_updated_at: saved.updated_at}]}), /policy/);
});

test('legacy inserts default unset and explicit policies round-trip through generic import', async () => {
  const source = await newItem();
  for (const policy of [undefined, 'restock', 'do_not_restock']) {
    const payload = {...source, id: (await db.query('select gen_random_uuid() as id')).rows[0].id};
    if (policy === undefined) delete payload.restock_policy;
    else payload.restock_policy = policy;
    payload.minimum_quantity = policy === 'restock' ? 1 : 0;
    payload.target_quantity = policy === 'restock' ? 4 : 0;
    await apply('mentor', {items: [{record: payload}]});
    assert.equal((await row(payload.id)).restock_policy, policy ?? 'unset');
  }
  const direct = (await asUser('mentor', tx => tx.query("insert into public.inventory_items(name,area_id,category,location_id) values('Default policy',$1,'Hardware',$2) returning restock_policy", [area, home]))).rows[0];
  assert.equal(direct.restock_policy, 'unset');
});

test('existing and future physical labels are unique, stable across names/parents, and immutable through direct API', async () => {
  const first = (await asUser('admin', tx => tx.query("insert into public.locations(name,location_type) values('New label drawer','Drawer') returning *"))).rows[0];
  assert.match(first.label_code, /^L-[0-9A-F]{12}$/);
  await asUser('admin', tx => tx.query("update public.locations set name='Renamed label drawer',parent_id=$1 where id=$2", [otherLocation, first.id]));
  const renamed = (await db.query('select * from public.locations where id=$1', [first.id])).rows[0];
  assert.equal(renamed.label_code, first.label_code);
  for (const replacement of ['L-ABCDEF123456', null, first.label_code.toLowerCase()]) {
    await assert.rejects(() => asUser('admin', tx => tx.query('update public.locations set label_code=$1 where id=$2', [replacement, first.id])), /immutable/);
  }
  await assert.rejects(() => asUser('admin', tx => tx.query("insert into public.locations(name,label_code) values('Duplicate label',$1)", [first.label_code])), /unique/);
  await assert.rejects(() => asUser('admin', tx => tx.query("insert into public.locations(name,label_code) values('Bad label','L-short')")), /locations_label_code_format/);
  await asUser('admin', tx => tx.query("update public.locations set active=false where id=$1", [first.id]));
  assert.equal((await db.query('select label_code from public.locations where id=$1', [first.id])).rows[0].label_code, first.label_code);
});

test('generic location upserts never reassign label codes; label lookup is read-only and keeps existing RLS', async () => {
  const location = (await db.query('select to_jsonb(l) as location from public.locations l where id=$1', [home])).rows[0].location;
  await apply('mentor', {locations: [{record: {...location, name: 'Drawer label unchanged', label_code: 'L-000000000001'}}]});
  assert.equal((await db.query('select label_code from public.locations where id=$1', [home])).rows[0].label_code, location.label_code);
  const before = await snapshot();
  for (const who of ['student', 'lead', 'readonly']) {
    const found = await asUser(who, tx => tx.query('select id from public.locations where label_code=$1', [location.label_code]));
    assert.deepEqual(found.rows, [{id: home}]);
    const write = await asUser(who, tx => tx.query("update public.locations set label_code='L-123456789ABC' where id=$1 returning id", [home]));
    assert.equal(write.rows.length, 0);
  }
  assert.deepEqual((await asUser('inactive', tx => tx.query('select id from public.locations where label_code=$1', [location.label_code]))).rows, []);
  await assert.rejects(() => db.transaction(async tx => {
    await tx.exec('set local role anon');
    return tx.query('select id from public.locations where label_code=$1', [location.label_code]);
  }), /permission/);
  assert.deepEqual(await snapshot(), before);
});

test('existing trip RPCs generate labels and preserve them through the lifecycle', async () => {
  const trip = (await asUser('mentor', tx => tx.query("select public.inventory_action('create_trip',$1) as result", [JSON.stringify({name: 'Label lifecycle regression'})]))).rows[0].result;
  const locations = (await db.query('select id,label_code from public.locations where trip_id=$1 order by id', [trip.id])).rows;
  assert.ok(locations.length > 0);
  assert.ok(locations.every(location => /^L-[0-9A-F]{12}$/.test(location.label_code)));
  for (const status of ['packing', 'closed']) await asUser('mentor', tx => tx.query("select public.inventory_action('trip_status',$1)", [JSON.stringify({tripId: trip.id, status})]));
  assert.deepEqual((await db.query('select id,label_code from public.locations where trip_id=$1 order by id', [trip.id])).rows, locations);
});

test('new RPCs use invoker security, fixed search path, authenticated-only execution and active-profile feature detection', async () => {
  const attrs = (await db.query("select proname,prosecdef,proconfig from pg_proc where proname in ('setup_inventory_item','inventory_setup_features') order by proname")).rows;
  assert.equal(attrs.length, 2);
  assert.ok(attrs.every(p => p.prosecdef === false && p.proconfig.includes('search_path=""')));
  for (const who of ['student', 'lead', 'readonly', 'admin']) assert.equal((await asUser(who, tx => tx.query('select public.inventory_setup_features() as version'))).rows[0].version, 1);
  await assert.rejects(() => asUser('inactive', tx => tx.query('select public.inventory_setup_features()')), /active profile/);
  for (const sql of ['select public.inventory_setup_features()', "select public.setup_inventory_item(null,null,'restock',0,1)"]) await assert.rejects(() => db.transaction(async tx => {
    await tx.exec('set local role anon');
    return tx.query(sql);
  }), /permission/);
  assert.equal((await asUser('student', tx => tx.query('select public.inventory_features() as version'))).rows[0].version, 4);
});
