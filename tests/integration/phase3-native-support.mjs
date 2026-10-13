// Private Unix-socket-only native PostgreSQL test cluster. This uses an explicit
// synthetic Auth shim and never substitutes for the real Auth/PostgREST suite.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { inventoryMigrations } from './inventory-sources.mjs';
import { lit, area } from './phase3-test-support.mjs';

export async function withNativePhase(phase, { prepare, migrations, sourceFiles = [], run }) {
  const bin = process.env.INVENTORY_PG_BIN;
  assert(bin && isAbsolute(bin), 'Set INVENTORY_PG_BIN to an installed PostgreSQL bin directory; existing databases are never accepted');
  const root = mkdtempSync(join(tmpdir(), `inventory-phase${phase}-pg-`)), data = join(root, 'db');
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: root, LANG: 'C.UTF-8', TZ: 'UTC' };
  const args = ['-X', '-h', root, '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'];
  const common = { env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 25_000, maxBuffer: 8 * 1024 * 1024 };
  const sql = input => execFileSync(join(bin, 'psql'), args, { ...common, input }).trim();
  const readSource = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const sourceHashes = Object.fromEntries([...new Set([...inventoryMigrations.map(name => `supabase/migrations/${name}`), ...migrations.map(name => `supabase/migrations/${name}`), ...sourceFiles, 'tests/integration/phase3-native-support.mjs', 'tests/integration/phase3-test-support.mjs', 'tests/integration/inventory-sources.mjs'])].map(path => [path, createHash('sha256').update(readSource(path)).digest('hex')]));
  const last = output => JSON.parse(output.split('\n').filter(Boolean).at(-1));
  const users = Object.fromEntries(['mentor', 'admin', 'lead', 'student', 'counter', 'finance', 'coach', 'readonly'].map((name, index) => [name, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
  const actor = name => { assert(users[name], 'Unknown synthetic actor'); return `select set_config('request.jwt.claim.sub',${lit(users[name])},false);set role authenticated;`; };
  const read = (table, id) => { assert(/^[a-z_]+\.[a-z_]+$/.test(table)); return last(sql(`select to_jsonb(t) from ${table} t where id=${lit(id)}`)); };
  const children = new Set(); let started = false; const checks = [];
  const pass = label => { checks.push(label); console.log(`PASS native Inventory phase ${phase}: ${label}`); };
  function session(name) {
    const child = spawn(join(bin, 'psql'), args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child); let out = '', err = '';
    const done = new Promise((resolve, reject) => {
      child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
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
  const blocked = (...names) => waitFor(() => Number(sql(`select count(*) from pg_stat_activity where application_name in (${names.map(lit).join(',')}) and wait_event_type='Lock'`)) === names.length, names.join(', '));
  const oneWinner = (results, pattern) => {
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'Exactly one competing mutation may commit');
    assert.match(results.find(result => result.status === 'rejected').reason.message, pattern);
  };
  try {
    execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'], { ...common, timeout: 30_000 });
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'server.log'), '-o', `-k ${root} -c listen_addresses='' -c unix_socket_permissions=0700`, '-w', 'start'], { ...common, timeout: 30_000 });
    started = true;
    assert.equal(sql("show listen_addresses"), '', 'The disposable cluster must have no TCP listener');
    sql(`create role anon;create role authenticated;create role service_role;create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const file of inventoryMigrations) sql(readSource(`supabase/migrations/${file}`));
    if (prepare) prepare({ sql, readSource });
    for (const file of migrations) sql(readSource(`supabase/migrations/${file}`));
    for (const [name, id] of Object.entries(users)) {
      const role = ['counter'].includes(name) ? 'student' : name === 'finance' ? 'lead' : name === 'coach' ? 'mentor' : name;
      sql(`insert into auth.users(id,email) values(${lit(id)},${lit(`${name}@example.invalid`)});
        update public.profiles set role=${lit(role)},primary_area_id=${role === 'lead' ? lit(area) : 'null'} where id=${lit(id)}`);
    }
    await run({ sql, readSource, last, users, actor, read, pass, checks, asyncSQL, gate, blocked, oneWinner });
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
  if (!process.exitCode) console.log(JSON.stringify({ status: 'PASS_NATIVE_POSTGRES_CONCURRENCY', phase, checks, source_sha256: sourceHashes }, null, 2));
}
