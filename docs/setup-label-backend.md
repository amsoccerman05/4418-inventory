# Inventory setup and physical location labels: backend contract

Migration: `supabase/migrations/20261012232840_inventory_setup_location_labels.sql`.
Apply after migrations 001–005. The file was generated using `supabase migration new inventory_setup_location_labels` (CLI 2.120.0). The migration is transactional. It is additive and not intended to be rerun.

## Preserved data and permissions

- Every existing item receives `restock_policy = 'unset'`, regardless of its minimum, target, quantity, or prior restock status. Existing zero thresholds never imply a decision not to restock.
- No existing inventory quantities, expected/minimum/target values, verification dates/actors, row timestamps, balances, movements, history, homes, or other values are changed during migration.
- Each existing location receives a unique `label_code`; existing location fields and timestamps remain unchanged. Labels are added through the column default rather than an UPDATE that would fire existing timestamp triggers.
- Existing RLS and role/area permissions remain in force. No table grants, roles, persistent credentials, policies, or SECURITY DEFINER functions are added or widened.
- Existing count/verification/transfer RPCs and `inventory_features()` remain unchanged. Setup never calls a count or verification RPC.

## Fields

`inventory_items.restock_policy`: non-null text, default `unset`, one of:

- `unset`: no explicit restock decision yet, including all pre-migration records.
- `restock`: explicit restocking; minimum and target must be finite and nonnegative, and target must be strictly greater than minimum.
- `do_not_restock`: explicit decision not to restock. Existing valid minimum/target values may remain stored; zero is not required or inferred.

A table trigger validates these invariants for direct REST writes as well as RPCs and CSV/import patches. PostgreSQL NaN and infinities are rejected. The existing dynamic item-metadata guard recognizes the new policy column and restricts edits to the assigned area's lead, an admin, or a mentor. Students may still count and verify without changing policy.

`locations.label_code`: non-null, unique text matching `L-[0-9A-F]{12}`. The database generates a value for future locations, including locations created by the existing trip workflow. Once inserted, the value is immutable, including for admin/mentor direct API edits. Renaming, reparenting, archiving, and ordinary location upserts retain the label. Generic location imports never copy or overwrite the physical label identifier.

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

## Capability and label lookup

`inventory_setup_features()` returns integer `1` to an authenticated user with an active profile, including readonly users. It rejects inactive/anonymous callers. Do not repurpose the existing logistics capability function, which continues to return `4`.

A barcode contains only the stable `label_code`. Resolve it through the existing authenticated `locations` SELECT access, for example:

```ts
await supabase.from('locations').select('*').eq('label_code', scannedCode).maybeSingle();
```

Lookup is read-only and does not count, verify, move, or modify the location. A QR code may point to the existing location deep link; opening it still uses the application's existing authentication. A label is an identifier, not a secret or authorization token. Unknown labels and inactive profiles must not bypass authentication. Existing location read semantics include archived locations for history; the UI can indicate an archived location after lookup.

## Verification

Run `node --test tests/setup-label-security.test.mjs` or the repository's aggregate `npm run test:security`. The independent PGlite suite applies the actual 001–005 SQL and the new migration, then verifies:

- Exact pre/post migration preservation of existing rows, timestamps, defaults, quantities, balances, verification actors, and history
- Explicit policies and assigned-area permissions for lead/admin/mentor versus student/other-area lead/readonly/inactive users
- Metadata-only setup, authenticated event attribution, student count/verification compatibility
- Exact-version rejection, malformed policy/threshold rejection (including NaN/infinities), direct API validation, and atomic batch rollback
- Backward-compatible policy omission/default behavior in generic imports
- Generated labels, uniqueness, immutable direct API values, rename/reparent/archive stability, generic upsert preservation, trip lifecycle compatibility, and existing RLS
- SECURITY INVOKER/search-path attributes, RPC grants, active-profile feature detection, and unchanged logistics capability

PGlite verifies PostgreSQL behavior; it does not test production PostgREST schema refresh or infrastructure. During the staged live release, compare read-only pre/post fingerprints excluding only the new columns, confirm no new count or verification events, and smoke-test the capability RPC and authenticated location lookup. Do not manufacture a production count to test setup. Publish the UI only after the schema contract is verified.
