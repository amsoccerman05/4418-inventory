#!/usr/bin/env node
// Real concurrent PostgreSQL sessions, synthetic Auth shim, isolated Unix socket.
// This complements (and never substitutes for) real Auth/PostgREST integration.
// Accepts only an installed bin DIRECTORY, never an existing database URL.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { inventoryMigrations } from '../integration/inventory-sources.mjs';

const bin = process.env.INVENTORY_PG_BIN;
assert(bin && isAbsolute(bin), 'Set INVENTORY_PG_BIN to an installed PostgreSQL bin directory');
const root = mkdtempSync(join(tmpdir(), 'inventory-pg-')), data = join(root, 'db');
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: root, LANG: 'C.UTF-8', TZ: 'UTC' };
const args = ['-X', '-h', root, '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'];
const common = { env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 25_000, maxBuffer: 8 * 1024 * 1024 };
const sql = input => execFileSync(join(bin, 'psql'), args, { ...common, input }).trim();
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const value = output => JSON.parse(output.split('\n').filter(Boolean).at(-1));
const users = Object.fromEntries(['mentor', 'admin', 'lead', 'student'].map((name, i) => [name, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));
const area = '44180000-0000-4000-8000-000000000001';
const home = '10000000-0000-4000-8000-000000000001';
const actor = name => `select set_config('request.jwt.claim.sub',${lit(users[name])},false);set role authenticated;`;
const read = id => value(sql(`select to_jsonb(i) from public.inventory_items i where id=${lit(id)}`));
const audits = id => Number(sql(`select count(*) from public.inventory_events where inventory_item_id=${lit(id)}`));
const balance = id => sql(`select jsonb_agg(to_jsonb(b) order by id) from public.inventory_balances b where inventory_item_id=${lit(id)}`);
const setup = (row, who = 'mentor', min = 1, target = 5) => `${actor(who)}select public.setup_inventory_item(${lit(row.id)},${lit(row.updated_at)},'restock',${min},${target});`;
const createItem = () => value(sql(`${actor('mentor')}insert into public.inventory_items(name,area_id,category,location_id,quantity,expected_quantity)
 values('Synthetic concurrency item',${lit(area)},'Synthetic',${lit(home)},7,9) returning to_jsonb(inventory_items);`));
const children = new Set();
let started = false, checks = 0;
const pass = label => { checks++; console.log(`PASS Inventory concurrency: ${label}`); };
function session(name) {
  const child = spawn(join(bin, 'psql'), args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let out = '', err = '';
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject); child.stdin.on('error', reject);
    child.on('close', code => { children.delete(child); code ? reject(Error(err || `psql exited ${code}`)) : resolve(out.trim()); });
  });
  done.catch(() => {});
  child.stdin.write("set statement_timeout='15s';set idle_in_transaction_session_timeout='20s';\n");
  return { child, done, output: () => out };
}
function asyncSQL(query, name) { const s = session(name); s.child.stdin.end(`${query}\n`); return s.done; }
async function waitFor(predicate, label) {
  const end = Date.now() + 10_000;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw Error(`Timed out waiting for ${label}`);
}
async function gate(name, query) {
  const s = session(name); s.child.stdin.write(`begin;${query};select 'INVENTORY_GATE_READY';\n`);
  await Promise.race([waitFor(() => s.output().includes('INVENTORY_GATE_READY'), name), s.done.then(() => { throw Error('Gate exited before release'); })]);
  return (beforeCommit = '') => { s.child.stdin.end(`${beforeCommit}commit;\n\\q\n`); return s.done; };
}
const rowGate = (name, id) => gate(name, `select id from public.inventory_items where id=${lit(id)} for update`);
const blocked = (...names) => waitFor(() => Number(sql(`select count(*) from pg_stat_activity where application_name in (${names.map(lit).join(',')}) and wait_event_type='Lock'`)) === names.length, names.join(', '));
const oneWinner = results => {
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /changed/);
};
try {
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'], { ...common, timeout: 30_000 });
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'server.log'), '-o', `-k ${root} -c listen_addresses='' -c unix_socket_permissions=0700`, '-w', 'start'], { ...common, timeout: 30_000 });
  started = true;
  sql(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const file of inventoryMigrations) sql(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  for (const [role, id] of Object.entries(users)) {
    sql(`insert into auth.users(id,email) values(${lit(id)},${lit(`${role}@example.invalid`)});
      update public.profiles set role=${lit(role)},primary_area_id=${role === 'lead' ? lit(area) : 'null'} where id=${lit(id)};`);
  }
  sql(`${actor('mentor')}insert into public.locations(id,name,location_type) values(${lit(home)},'Synthetic concurrency drawer','Drawer');`);

  let row = createItem(), beforeBalance = balance(row.id), beforeAudits = audits(row.id);
  let release = await rowGate('setup-gate', row.id);
  let pair = Promise.allSettled([
    asyncSQL(setup(row, 'mentor', 1, 5), 'setup-one'),
    asyncSQL(setup(row, 'lead', 2, 8), 'setup-two'),
  ]);
  await blocked('setup-one', 'setup-two'); await release();
  let results = await pair; oneWinner(results);
  assert.equal(audits(row.id), beforeAudits + 1); assert.equal(balance(row.id), beforeBalance);
  assert.equal(read(row.id).quantity, 7); assert.equal(read(row.id).last_verified_at, null);
  pass('queued setup saves share one row lock; one version wins and one event commits without counting or verifying');

  row = createItem(); beforeAudits = audits(row.id);
  release = await rowGate('count-first-gate', row.id);
  const staleSetup = asyncSQL(setup(row), 'stale-setup');
  await blocked('stale-setup');
  await release(`${actor('student')}select public.change_inventory_quantity(${lit(row.id)},1,null,null,true);`);
  await assert.rejects(staleSetup, /changed/);
  assert.equal(read(row.id).quantity, 8); assert.equal(read(row.id).restock_policy, 'unset');
  assert.equal(read(row.id).last_verified_by, users.student);
  assert.equal(audits(row.id), beforeAudits + 2); // Count and verification are separate existing events.
  pass('count/verification committed while setup waits invalidates setup without overwriting the new count');

  row = createItem(); beforeAudits = audits(row.id);
  release = await rowGate('setup-first-gate', row.id);
  const queuedDelta = asyncSQL(`${actor('student')}select public.change_inventory_quantity(${lit(row.id)},1);`, 'queued-delta');
  await blocked('queued-delta');
  await release(setup(row, 'lead', 2, 9));
  await queuedDelta;
  assert.equal(read(row.id).quantity, 8); assert.equal(read(row.id).restock_policy, 'restock');
  assert.equal(read(row.id).minimum_quantity, 2); assert.equal(read(row.id).target_quantity, 9);
  assert.equal(audits(row.id), beforeAudits + 2);
  pass('a queued atomic count after setup preserves both the new policy and the quantity increment');

  row = createItem(); beforeAudits = audits(row.id);
  release = await rowGate('same-retry-gate', row.id);
  pair = Promise.allSettled([asyncSQL(setup(row), 'retry-one'), asyncSQL(setup(row), 'retry-two')]);
  await blocked('retry-one', 'retry-two'); await release(); results = await pair; oneWinner(results);
  assert.equal(audits(row.id), beforeAudits + 1);
  pass('simultaneous identical setup retries produce one write and a stale-version response');

  row = createItem(); beforeAudits = audits(row.id); beforeBalance = balance(row.id);
  release = await rowGate('revoke-gate', row.id);
  const revoked = asyncSQL(setup(row, 'lead'), 'revoked-setup');
  await blocked('revoked-setup');
  sql(`update public.profiles set active=false where id=${lit(users.lead)}`);
  await release(); await assert.rejects(revoked, /active|assigned lead|unavailable|permission|change inventory/);
  assert.equal(audits(row.id), beforeAudits); assert.deepEqual(read(row.id), row); assert.equal(balance(row.id), beforeBalance);
  sql(`update public.profiles set active=true where id=${lit(users.lead)}`);
  pass('profile revocation while a setup waits prevents the eventual write');

  const label = 'L-' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  release = await gate('label-unique-gate', 'select pg_advisory_xact_lock(4419)');
  const insertLabel = name => `${actor('mentor')}insert into public.locations(name,label_code) values(${lit(name)},${lit(label)}) returning id;`;
  pair = Promise.allSettled([asyncSQL(insertLabel('Synthetic label one'), 'label-one'), asyncSQL(insertLabel('Synthetic label two'), 'label-two')]);
  await blocked('label-one', 'label-two'); await release(); results = await pair;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /unique|duplicate/);
  assert.equal(Number(sql(`select count(*) from public.locations where label_code=${lit(label)}`)), 1);
  pass('concurrent explicit label collisions cannot create two locations with the same physical label');

  const original = value(sql(`select to_jsonb(l) from public.locations l where id=${lit(home)}`));
  release = await gate('immutable-label-gate', `select id from public.locations where id=${lit(home)} for update`);
  pair = Promise.allSettled([
    asyncSQL(`${actor('mentor')}update public.locations set name='Synthetic renamed drawer' where id=${lit(home)};`, 'rename-location'),
    asyncSQL(`${actor('admin')}update public.locations set label_code='L-ABCDEF123456' where id=${lit(home)};`, 'change-label'),
  ]);
  await blocked('rename-location', 'change-label'); await release(); results = await pair;
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.match(results[1].reason.message, /immutable/);
  const renamed = value(sql(`select to_jsonb(l) from public.locations l where id=${lit(home)}`));
  assert.equal(renamed.label_code, original.label_code); assert.equal(renamed.name, 'Synthetic renamed drawer');
  pass('a rename concurrent with a forbidden label rewrite preserves the original physical identity');
  console.log(`${checks} native PostgreSQL inventory concurrency checks passed`);
} catch (error) {
  console.error(error.message);
  if (!started) { try { console.error(readFileSync(join(root, 'server.log'), 'utf8')); } catch {} }
  process.exitCode = 1;
} finally {
  await Promise.all([...children].map(child => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('close', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
  })));
  let cleaned = !started;
  if (started) {
    try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { ...common, timeout: 20_000 }); cleaned = true; }
    catch (error) { console.error(`Disposable PostgreSQL cleanup failed: ${error.message}`); process.exitCode = 1; }
  }
  if (cleaned) rmSync(root, { recursive: true, force: true });
  else console.error(`Retained synthetic cluster: ${root}`);
}
