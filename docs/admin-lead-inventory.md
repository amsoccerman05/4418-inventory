# Inventory role compatibility

This adapter introduces the literal `admin_lead` role without treating it as a
Mentor or owner Admin. The shared Hub core migration
`20261028160322_student_admin_lead_roles.sql` must be applied first by the shared
database release owner. Do not blanket-push a repository's historical migrations.

| Active account | Everyday stock | Item metadata/media/deletion | Normal locations | Approve packing | Trip/loss/global administration |
| --- | --- | --- | --- | --- | --- |
| Student, no area or position | Add in eligible areas, count, verify, move; pack/move/return approved stock | No | Only existing qualifying-position create/name-only rename | No | No |
| Lead / Admin Lead | Same as Student | Own primary area only | Existing qualifying-position create/name-only rename; otherwise project-only with active primary area | Existing team-wide scope, even without an area | No |
| Readonly | View only | No | No, even with a retained position | No | No |
| Inactive | No access | No | No | No | No |
| Mentor / existing Admin | Existing staff privileges unchanged | Existing staff scope | Existing staff scope | Existing staff scope | Existing staff scope |

An ordinary Student needs no primary-area assignment, functional position or
Attendance registration to use everyday Inventory. Prospective membership does
not block stock work. Named-position normal-location eligibility retains its
existing confirmed, previously signed-in, not-banned and non-inactive-membership
checks. Readonly and inactive status win over retained positions.

## Migration integrity

`20261028160648_inventory_admin_lead_compatibility.sql` changes exactly six
existing function definitions by reviewed role-predicate substitutions. Full
`pg_get_functiondef` MD5s are checked before and after each replacement; predicate
counts are an additional guard, not a substitute for source pinning. Any drift
aborts the transaction. No grants, policies, ownership, user rows, role conversion,
shared profile guards or shared position functions change.

`tests/fixtures/inventory-role-function-pins.json` contains fresh catalog-only
source/ACL/owner/security pins and exact expected output. Release preflight must
also compare all six ACLs/owners/configuration and shared prerequisite state;
postflight must verify expected bodies and unchanged ACLs/policies/data. Only the
coordinator applies the ordered shared migrations after all app checks pass.

## Verification and fixture boundaries

- `npm run test:unit`: role allowlists and source/component regression tests.
- `node --test --test-concurrency=1 tests/*security.test.mjs`: actual Inventory
  migration/RLS tests, exact function replacement and preservation, cross-area
  denial, Student no-area stock work, retained-position Readonly denial, and
  team-wide manifest-approval parity.
- `npm run test:logistics`: genuine Student/Admin Lead/Readonly UI journeys at
  390 and 1440 pixels, with screenshots, failed editor save/draft retry and
  approved-stock movement. All requests are restricted to synthetic loopback
  servers; unknown HTTP/WebSocket requests fail closed, service workers blocked.
- The local PGlite fixture's role CHECK and minimal shared tables are explicitly
  test prerequisites, **not** proof of the complete shared Hub authorization
  model or native PostgreSQL concurrency. Combined actual shared migrations and
  native/API checks remain separate release gates. No live auth accounts or
  business records are used.

The original audit fixes are preserved. Held Inventory PR4 and QR work are not
part of this change. Browser collection is not browser execution; hosted results
and retained screenshots must be inspected before clearance.
