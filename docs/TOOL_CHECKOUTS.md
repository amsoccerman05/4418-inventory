# Phase 5: tool checkout and return

Recovered on top of published phase 3 commit `19f629786f61ee88ce033c7a85817bc449b4e3bf` after the execution filesystem rollback. The reviewed phase 5 accounting model, SQL safeguards, UI, and regression coverage were reconstructed from the visible conversation/tool inputs; restricted session files were not accessed.

## User workflow

The app now includes **Tool checkouts** navigation at `#checkouts`. Only items explicitly marked **Tool** are eligible. Checkout requires a positive whole-number quantity, who has the tool, two distinct active non-travel locations, and an expected return date. Project/purpose and notes are optional. Consumables retain quantity workflows.

A checkout transfers physical stock from its source balance to the destination and creates a custody claim against that destination. The owned total is unchanged. Outstanding loans show borrower, project, last-known location, original return location, due date, original quantity, and remaining quantity. Filters show outstanding, overdue, missing, returned, or all loans.

Returns target one specific loan, support partial quantities, and move only that loan's stock back to its original source. Returned history is retained. Marking missing/found requires a note and does not destroy owned stock: missing loans retain their last-known-location balance and remain outstanding until found/returned.

## Accounting and permission safeguards

- Existing active counting roles (`student`, `lead`, `admin`, `mentor`) can check out and return tools, matching existing movement/count permissions. Readonly members can read; inactive and anonymous users cannot read or mutate loans. No existing role/area powers are expanded.
- Shared mutations use a private definer function with an empty search path and explicit active-role checks, reached through a public invoker wrapper. RLS protects reads; public/anonymous execution and direct table mutations are revoked.
- Permission is rechecked after operation-advisory, item-row, loan-row, and location-advisory lock waits. Queued requests cannot rely solely on authority checked before waiting.
- Private durable receipts bind each operation UUID to actor, action, and exact payload. Replays are safe; a changed actor/payload cannot reuse the key. Item/loan locks and optimistic loan versions prevent duplicate/stale returns.
- An AFTER balance trigger prevents generic moves, counts, legacy total bridges, and trip packing from reducing balances below outstanding claims. AFTER is essential: ordinary audit `INSERT 0 ON CONFLICT DO NOTHING` must remain harmless.
- Loan-location auditing changes verification stamps only, preserving balance quantities and loan claims. Stale snapshots fail atomically.
- New/increased manifest approvals account for loan claims and other active approved rows. Existing approval reductions/resolutions remain allowed, so stale plans can be cleared.
- Open loans prevent changing item type, ownership, or home. Empty origins and occupied destinations cannot be archived or converted to travel until all loans return. History foreign keys prevent deleting referenced items/locations.
- UI source availability excludes loans and pending trip approvals. Item-location rows show physical/last-known quantity, checked-out claims, and availability. Drawer completeness continues to count assigned-elsewhere stock rather than falsely marking checked-out tools missing.
- Demo mutations use the existing shared `localWrite` helper and `inventory-demo-write` Web Lock. Checkout rereads storage inside that lock; it does not acquire nested locks. Browsers without Web Locks cannot create/update loan workflows.
- An uncertain/lost response keeps the exact operation and form data for a safe retry. A definite stale-loan error requires explicit **Review latest loan**; that button stays disabled during refresh and while the version is unchanged.

## Integration details

- Component: `ToolCheckouts` from `src/tool-checkouts.tsx`, props `db`, `profile`, `refresh`, optional `itemId`.
- Repository method: `toolAction(action, data)`.
- Optional `Logistics.toolLoans`: undefined means the shared schema is absent; an empty array means available with no loans. No fake loan rows are seeded.
- `tool_checkout_features()` is separate from existing capability/version probes. Reads are paginated; realtime includes `tool_loans` and retains periodic/focus refresh fallback.
- Main navigation is included in this recovery commit. Phase 3 purchasing/setup changes and its stale generic-save checks are preserved.
- Phase 4 supplies `private.packing_external_reserved(uuid,uuid)` initially returning zero; phase 5 replaces it with `private.tool_loan_reserved`. Phase 4 preflight must subtract this hook.
- On the combined branch, packing review availability must subtract `loanQuantityAt(db,itemId,locationId)` from physical quantity minus existing approvals. Packing and purchasing demo mutations must use the same `localWrite(...,true)` helper. The coordinator owns these phase 4 cross-feature integration edits.

## Migration

`supabase/migrations/20261012232741_tool_checkouts.sql` restores the original migration filename generated with Supabase CLI 2.120.0 after checking CLI help during the initial implementation. This recovery does not invent or apply a new migration identity.

Apply once at the authorized phase 5 release, after the prior staged releases. It creates empty loan/receipt tables; it inserts no production stock or loan fixtures and does not backfill/change balances. The movement constraint adds four custody event types while retaining existing transfer/travel/adjustment/resolution values. Any future additional movement types must also be preserved.

No production writes, migration application, push, or deployment were performed by this recovery worker.

## Verification and release gates

Passed after recovery:

- `npm run build`: TypeScript and Vite, including the real `#checkouts` route
- `npm run test:security`: 59 passed, 0 failed, 2 explicitly skipped combined cases (both separately passed against the restored phase 4 migration)
- `node --test tests/tool-checkouts-security.test.mjs`: all 11 reviewed custody/accounting/security tests
- `PACKING_TEMPLATE_MIGRATION=/path/to/20261012232702_packing_templates.sql node --test tests/tool-checkouts-packing-security.test.mjs`: both combined packing tests
- `npx playwright test --config playwright.tool-checkouts.config.ts --grep 'model preserves'`
- `TEST_TOOL_SHARED=1 npx playwright test --config playwright.tool-checkouts.config.ts --grep 'HTTP contract'`

The combined tests automatically find the adjacent phase 4 migration after integration, or explicitly skip if it is absent. They verify atomic rejection of duplicate-line and independent second approvals for four physical tools with three loaned, plus partial/full cleanup of a stale plan.

PGlite concurrency simulations are not independent PostgreSQL-session tests. The coordinator's restored native/real-Auth phase 5 runners remain release gates, including queued authorization revocation and actual competing checkout/return sessions.

Browser suites are reconstructed and now exercise the full app, rather than only an isolated component harness:

- `npx playwright test --config playwright.tool-checkouts.config.ts`
- `TEST_TOOL_SHARED=1 npx playwright test --config playwright.tool-checkouts.config.ts`

Coverage: navigation, duplicate submit, checkout/partial/final return, missing/found, reload persistence, Escape/Cancel, readonly controls, mobile overflow, committed-but-lost response replay with identical operation IDs, and stale-return re-review. Ports: demo 5180, shared UI 5181, local HTTP fixture 54335. They use synthetic local data only. Browser execution was blocked by the previously verified Chromium socket restriction in this environment; no successful browser run or screenshots are claimed here. Run CI against the final integrated commit before release.
