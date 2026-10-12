#!/usr/bin/env node
// Owns a new loopback-only Auth/PostgREST stack. No link, reset, deploy, or remote API.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { CLI_VERSION, API_PORT, DB_PORT, ORIGIN, localStatus, isolatedEnvironment } from './inventory-safety.mjs';
import { inventoryMigrations } from './inventory-sources.mjs';
import { runInventoryIntegration } from './inventory-stack.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2] || '--run';
assert(['--run', '--preflight', '--prepare-only'].includes(mode), 'Use --run, --preflight, or --prepare-only');
const executable = process.env.INVENTORY_SUPABASE_CLI || 'supabase';
assert(executable === 'supabase' || isAbsolute(executable), 'CLI override must be an absolute local binary path');
const root = mkdtempSync(join(tmpdir(), 'inventory-integration-'));
const project = `inventory-it-${randomUUID().slice(0, 12)}`;
const network = `${project}-loopback`;
const env = isolatedEnvironment(root);
mkdirSync(env.HOME, { recursive: true });
const common = { cwd: root, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 };
const cli = (args, timeout = 60_000) => execFileSync(executable, [...args, '--workdir', root, '--network-id', network], { ...common, timeout }).trim();
const docker = args => execFileSync('docker', args, { ...common, timeout: 45_000 }).trim();
const sql = input => execFileSync('docker', ['exec', '-i', `supabase_db_${project}`, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], { ...common, input, timeout: 45_000 }).trim();
let started = false, networkCreated = false, report, cleaned = false;
const secrets = [];
const clean = text => secrets.reduce((out, secret) => out.replaceAll(secret, '[local-key]'), String(text))
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[local-jwt]')
  .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[local-key]');
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  let failed = false;
  if (started) {
    try { cli(['stop', '--project-id', project, '--no-backup'], 120_000); }
    catch (error) { console.error(`Disposable stack cleanup failed: ${clean(error.message)}`); failed = true; }
  }
  if (networkCreated && !failed) {
    try { docker(['network', 'rm', network]); }
    catch (error) { console.error(`Disposable network cleanup failed: ${clean(error.message)}`); failed = true; }
  }
  if (failed) {
    process.exitCode = 1;
    console.error(`Retained synthetic workspace: ${root}\nCleanup only this run: supabase stop --workdir ${root} --project-id ${project} --no-backup\nThen: docker network rm ${network}`);
  } else rmSync(root, { recursive: true, force: true });
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => { cleanup(); process.exit(code); });

try {
  const sources = [
    ...inventoryMigrations.map(name => `supabase/migrations/${name}`),
    ...['inventory-local.mjs', 'inventory-safety.mjs', 'inventory-sources.mjs', 'inventory-stack.mjs'].map(name => `tests/integration/${name}`),
  ];
  const hashes = Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(join(repo, path))).digest('hex')]));
  const version = execFileSync(executable, ['--version'], common).trim();
  assert.equal(version, CLI_VERSION, `Install the pinned official Supabase CLI ${CLI_VERSION}`);
  for (const command of ['init', 'start', 'status', 'stop']) cli([command, '--help']);
  if (mode !== '--prepare-only') {
    try { docker(['info', '--format', '{{.ServerVersion}}']); }
    catch { throw Error('BLOCKED: a working local Docker daemon at /var/run/docker.sock is required. No integration tests ran.'); }
  }
  if (mode === '--preflight') console.log(`PASS preflight: Node ${process.version}, Supabase CLI ${version}, local Docker`);
  else {
    cli(['init']);
    // Fresh configuration only: repository .env, .temp and linked project state are never copied.
    writeFileSync(join(root, 'supabase/config.toml'), `project_id = "${project}"
[api]
enabled = true
port = ${API_PORT}
schemas = ["public"]
extra_search_path = ["public", "extensions"]
[db]
port = ${DB_PORT}
shadow_port = 54330
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
[realtime]
enabled = false
[local_smtp]
enabled = false
[analytics]
enabled = false
[storage]
enabled = true
[auth]
enabled = true
site_url = "${ORIGIN}"
additional_redirect_urls = []
enable_signup = true
enable_anonymous_sign_ins = false
[auth.email]
enable_signup = true
enable_confirmations = false
[auth.rate_limit]
sign_in_sign_ups = 100
[edge_runtime]
enabled = false
`);
    if (mode === '--prepare-only') {
      console.log(JSON.stringify({ status: 'PREPARED_ONLY_NOT_EXECUTED', cli: version, source_sha256: hashes }, null, 2));
    } else {
      console.log(`Starting disposable local stack ${project}; cold image pulls can take several minutes.`);
      docker(['network', 'create', '--label', `inventory.integration=${project}`, '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', network]);
      networkCreated = true;
      started = true;
      cli(['start', '--exclude', 'realtime,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor,edge-runtime'], 12 * 60_000);
      const containerIDs = docker(['ps', '-q', '--filter', `network=${network}`]).split('\n').filter(Boolean);
      assert(containerIDs.length >= 5, 'Expected real local Auth, REST, gateway, storage, and database containers');
      for (const container of JSON.parse(docker(['inspect', ...containerIDs]))) {
        for (const bindings of Object.values(container.NetworkSettings.Ports || {})) {
          for (const binding of bindings || []) assert(['127.0.0.1', '::1'].includes(binding.HostIp), `Non-loopback published port rejected for ${container.Name}`);
        }
      }
      const status = localStatus(JSON.parse(cli(['status', '-o', 'json'])));
      secrets.push(status.anonKey, status.serviceKey);
      assert.equal(sql('select count(*) from auth.users'), '0', 'Refusing a nonempty Auth database');
      assert.equal(sql('select count(*) from storage.objects'), '0', 'Refusing nonempty Storage');
      assert.equal(sql("select coalesce(to_regclass('public.inventory_items')::text,'absent')"), 'absent', 'Refusing existing Inventory tables');
      const authFunction = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
      assert(!authFunction.includes('test.uid'), 'Mock auth.uid is forbidden');
      for (const name of inventoryMigrations) sql(readFileSync(join(repo, 'supabase/migrations', name), 'utf8'));
      sql("notify pgrst, 'reload schema';");
      const checks = await runInventoryIntegration({ ...status, sql, registerSecret: value => secrets.push(value) });
      assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction, 'Auth function changed');
      const image = JSON.parse(docker(['inspect', `supabase_db_${project}`]))[0].Config.Image;
      report = { status: 'PASS_REAL_SUPABASE_INTEGRATION', cli: version, node: process.version, postgres_image: image, checks, source_sha256: hashes };
    }
  }
} catch (error) {
  console.error(clean(error.message)); process.exitCode = 1;
} finally { cleanup(); }
if (report && !process.exitCode) console.log(JSON.stringify(report, null, 2));
