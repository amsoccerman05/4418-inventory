// Explicit approved schema/function copies only. No hosted project, user export,
// production roles, stock, PO rows, or notification sender is ever read or run.
import assert from 'node:assert/strict';
export const phase3Migration = '20261013234530_inventory_restock_finance_receiving.sql';
export const phase3FixtureFiles = ['team-live-authority.sql', 'finance-v1.sql', 'finance-budget.sql', 'finance-live-authority.sql', 'finance-notifications.sql', 'finance-live-notifications.sql']
  .map(name => `tests/fixtures/${name}`);
export const phase3SourceFiles = [...phase3FixtureFiles,
  `supabase/migrations/${phase3Migration}`, 'tests/integration/phase3-sources.mjs',
  'tests/integration/phase3-test-support.mjs', 'tests/integration/phase3-restock.mjs'];
// Apply after the reviewed baseline migrations, before the phase 3 migration.
// readSource accepts repo-relative paths; the owned runner supplies readFileSync.
export function installPhase3Prerequisites({ sql, readSource }) {
  assert.equal(sql("select coalesce(to_regclass('public.finance_purchase_orders')::text,'absent')"), 'absent', 'Finance fixtures require an empty disposable schema');
  assert.equal(sql("select coalesce(to_regclass('public.team_member_positions')::text,'absent')"), 'absent', 'Never overwrite existing role assignments');
  sql(`create table public.team_attendance_members(student_id uuid,member_status text);
    create table public.team_positions(key text primary key,name text,active boolean default true);
    create table public.team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
    revoke all on public.team_attendance_members,public.team_positions,public.team_member_positions from public,anon,authenticated;`);
  for (const path of phase3FixtureFiles) sql(readSource(path));
  sql(`revoke all on function public.team_my_positions(),public.team_has_position(text),public.team_has_any_position(text[]) from public,anon;
    grant execute on function public.team_my_positions(),public.team_has_position(text),public.team_has_any_position(text[]) to authenticated;`);
  for (const table of ['public.finance_purchase_orders', 'public.team_member_positions', 'public.team_notifications'])
    assert.equal(sql(`select count(*) from ${table}`), '0', 'Schema-only Finance copies must not import operational rows');
}
