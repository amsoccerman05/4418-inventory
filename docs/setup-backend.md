# Inventory setup: backend contract

Migration: `supabase/migrations/20261013234406_inventory_setup.sql`.
Apply after migrations 001–005 and before the restock/Finance migration. The later restock, packing and checkout migration filenames were regenerated in dependency order using the official CLI; none of their prior identities were applied to production. The file was generated using `supabase migration new inventory_setup` (CLI 2.119.0). The migration is transactional. It is additive and not intended to be rerun.

## Preserved data and permissions

- Every existing item receives `restock_policy = 'unset'`, regardless of its minimum, target, quantity, or prior restock status. Existing zero thresholds never imply a decision not to restock.
- No existing inventory quantities, expected/minimum/target values, verification dates/actors, row timestamps, balances, movements, history, homes, or other values are changed during migration.
- Existing location columns, defaults, constraints, triggers, rows and timestamps are unchanged.
- Existing RLS and role/area permissions remain in force. No table grants, roles, persistent credentials, policies, or SECURITY DEFINER functions are added or widened.
- Existing count/verification/transfer RPCs and `inventory_features()` remain unchanged. Setup never calls a count or verification RPC.

## Fields

`inventory_items.restock_policy`: non-null text, default `unset`, one of:

- `unset`: no explicit restock decision yet, including all pre-migration records.
- `restock`: explicit restocking; minimum and target must be finite and nonnegative, and target must be strictly greater than minimum.
- `do_not_restock`: explicit decision not to restock. Existing valid minimum/target values may remain stored; zero is not required or inferred.

A table trigger validates these invariants for direct REST writes as well as RPCs and CSV/import patches. PostgreSQL NaN and infinities are rejected. The existing dynamic item-metadata guard recognizes the new policy column and restricts edits to the assigned area's lead, an admin, or a mentor. Students may still count and verify without changing policy.

## Setup RPC

`setup_inventory_item(p_id uuid, p_expected_updated_at timestamptz, p_policy text, p_minimum numeric, p_target numeric)`

Example client call:

```ts
const { data, error } = await supabase.rpc('setup_inventory_item', {
  p_id: item.id,
  p_expected_updated_at: item.updated_at,
  p_policy: 'restock',
  p_minimum: 2,
  p_target: 6,
});
// data = { item: complete_saved_database_row }
```

The function uses SECURITY INVOKER, a fixed empty search path, existing RLS, and `private.can_edit(area_id)`. It locks the item and requires the exact last-seen database timestamp. Send the original timestamp string without truncating its fractional precision. A missing/stale version or removed item returns SQLSTATE `40001`; permission failures return `42501`; invalid policy/threshold values return `23514`. Refresh after stale errors and require the user to review again rather than silently replacing the version and retrying.

Only `restock_policy`, `minimum_quantity`, and `target_quantity` are assigned. Existing triggers also update the authenticated `updated_by` / `updated_at` and append an ordinary metadata event. Quantities, expected quantities, last verification, balances, and homes are unchanged. All three policy values are accepted, including an explicit reset to `unset`. A do-not-restock setup should pass the item's existing valid thresholds when they should be preserved.

`apply_inventory_changes(p_changes jsonb)` also supports `restock_policy` in item records. On update, an omitted key preserves the existing policy. On insert, an omitted key becomes `unset`; explicit null is invalid. The existing batch-wide transaction and stale guards remain. A failed row rolls back every change and event in the batch.

## Capability

`inventory_setup_features()` returns integer `1` to an authenticated user with an active profile, including readonly users. It rejects inactive/anonymous callers. Do not repurpose the existing logistics capability function, which continues to return `4`.

## Verification

Run `node --test tests/setup-security.test.mjs` or the repository's aggregate `npm run test:security`. The independent PGlite suite applies the actual 001–005 SQL and the new migration, then verifies:

- Exact pre/post migration preservation of existing rows, timestamps, defaults, quantities, balances, verification actors, and history
- Explicit policies and assigned-area permissions for lead/admin/mentor versus student/other-area lead/readonly/inactive users
- Metadata-only setup, authenticated event attribution, student count/verification compatibility
- Exact-version rejection, malformed policy/threshold rejection (including NaN/infinities), direct API validation, and atomic batch rollback
- Backward-compatible policy omission/default behavior in generic imports
- Authenticated location reads, denied unauthorized edits, ordinary upserts, trip lifecycle compatibility, and unchanged location schema and existing RLS
- SECURITY INVOKER/search-path attributes, RPC grants, active-profile feature detection, and unchanged logistics capability

PGlite verifies PostgreSQL behavior; it does not test production PostgREST schema refresh or infrastructure. During the staged live release, compare read-only pre/post fingerprints excluding only the new restock-policy column, confirm no new count or verification events, and smoke-test the capability RPC and authenticated location-by-ID lookup. Do not manufacture a production count to test setup. Publish the UI only after the schema contract is verified.
