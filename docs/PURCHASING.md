# Inventory restock → Finance → receiving

## Integration

This additive phase 3 release integrates purchasing and receiving into the existing Restock screen. The migration is prepared for release review; it has not been applied to the shared project, and development created no real requests, POs, deliveries, approvals, notifications or payments.

`main.tsx` imports `PurchasingPanel` from `src/purchasing.tsx` and renders:

```tsx
<PurchasingPanel db={db} profile={profile} refresh={refresh} onOpenItem={openItem} />
```

The panel is mounted in Restock. Optional `itemId={item.id}` limits it to an item. `refresh` must reload the inventory repository after a receipt. The component imports its stylesheet. This phase 3 release mounts the panel in `main.tsx` Restock, passes `onOpenItem` for legacy-order review, and serializes local repository writes with a shared lock and stale-snapshot guard. The Finance app and existing InventoryRepository interface remain unchanged. The panel has an independent production/demo adapter.

A missing RPC yields an explicit “not enabled yet” state. Authorization/network errors remain errors and never silently switch the shared workspace to local data. Reload on focus or use Refresh purchasing after Finance changes.

## Workflow

1. An item's assigned lead, admin or mentor configures a supplier, purchase unit and stock-unit conversion. Each pack/box/reel has a positive number of existing item stock units. An estimated catalog cost is optional; unknown values stay blank. No minimum, target, supplier URL or price is invented for existing items.
2. Any active inventory writer explicitly creates a request for a whole number of purchase units. Its supplier, area, stock unit, conversion and estimate are immutable snapshots. One open request per item prevents duplicate demand. Stable request IDs make exact retries harmless.
3. The requester or current assigned inventory editor explicitly creates a Finance draft or links an existing PO. Creating delegates to the existing `public.finance_mutate('create', …)` RPC, retaining its authority, validation and auditing. A Google Sheet/Doc and a positive total including shipping/tax are required. Creating a request alone does not create a PO.
4. Existing Finance handles submission, Finance Lead approval, Lead Coach approval, exceptions, budget allocation and school submission. The two current-revision approvals must be from different people. This feature never performs those actions in production.
5. A school submitter or mentor/admin with existing PO visibility records the supplier order reference after the PO has both approvals and has been submitted to the school. This records an order placed elsewhere; it does not place one. Only then is the quantity shown as “on order.”
6. An active inventory writer receives the physical delivery in STOCK units into an active non-travel location. Partial receipts keep the remainder on order. A unique delivery/packing-slip reference and stable receipt ID prevent replay. Overreceipts, stale versions, changed units and invalid locations fail without partial writes. A full receipt closes the request.
7. Assigned inventory editors may close a short-shipped remainder with a reason, keeping received stock. A linked request can be cancelled only after its PO was cancelled through Finance. No Finance cancellation, financial reversal or payment occurs automatically.

### Quantity accounting

`requested` sums unreceived units on requested/PO-linked requests. `on order` sums unreceived units on explicitly recorded orders. Suggested packs are `ceil(max(0, target - owned - requested - onOrder) / unitsPerPack)`. An explicit `do_not_restock` policy blocks new requests in both database and demo, suppresses default suggestions, and can only be changed through the existing assigned-lead item setup. Existing orders remain available for receiving. A target of zero shows “needs setup,” not a fabricated purchasing recommendation.

For example, two reels of 12.5 ft request 25 ft. Receiving 7.5 ft adds 7.5 to the receiving location and leaves 17.5 on order. It never adds 7.5 reels or multiplies received stock units again. Other location balances and expected home-tool quantities are unchanged. Legacy `order_status` tags are retained and do not count as new purchase orders or receipts. A legacy `Ordered` flag shows an unknown pending quantity and suppresses new purchasing recommendations until reconciled. It blocks creating another Finance draft at the database and demo boundary. A request can still be created to link the existing PO, or the authorized editor can review the legacy status in item details. The flag is never auto-rewritten.

The initial bounded design is one inventory item/request per Finance PO. A unique `po_id` prevents the same whole PO from silently backing several inventory requests. Multi-line PO allocation would require an explicit subsequent schema and UI design.

## Visibility and authority

The migration creates a non-exposed `inventory_purchasing` schema with settings, requests, receipts and history. Every table has RLS enabled and no direct client table/sequence grants. Private checked definer functions have fixed empty search paths. Public RPC wrappers are invokers. Only authenticated callers may execute them, and each call checks the active profile. No user-editable JWT metadata is trusted.

- Catalog supplier/configuration and estimated pack cost have the same active-inventory-reader audience as existing `inventory_items.vendor`, `vendor_url` and `approx_unit_cost`. They are inventory estimates, not Finance amounts or approved commitments.
- Request notes and closure reasons are ordinary team-visible inventory notes. The UI labels request notes as visible to inventory teammates. Do not put confidential financial material there.
- PO ID, number, status, revision and actual total are returned ONLY when `finance_private.visible(po_id)` allows it. The request projection removes raw PO IDs, stored approval revision, order reference, requester ID and ordering actor.
- No Finance sheet URL, purpose or freeform notes are copied to the inventory context. Draft creation copies the inventory request note into Finance, never the reverse.
- Receipt summaries contain only receipt/request IDs, quantity, location and timestamp. Delivery references, receipt notes and actor IDs remain private. The private audit history has no client read grant and is not returned by context.
- Linking requires Finance visibility plus PO ownership or Finance administration. Supplier and area must match, the PO must not be cancelled, and its total cannot be below the known catalog estimate.
- Recording an order requires existing school-submitter capability or mentor/admin role; an ordinary inventory lead is not promoted to that authority.
- Receiving is an inventory accounting action and does not require visibility of financial details. The server independently checks the stored PO/revision still has both approvals and school submission.

All purchasing actions take the same advisory lock as Finance before acquiring request/item/PO locks. Item row locks serialize with existing inventory movements. Receipt row insertion, location balance increment, derived total, movement, received count, state and audit commit in one transaction. Database uniqueness protects one open request, one PO allocation and one delivery reference per request. The legacy balance helpers are reused rather than bypassed.

## Migration / rollout plan (approval required)

Migration: `supabase/migrations/20261012234215_inventory_restock_finance_receiving.sql`, created with Supabase CLI 2.120.0 `migration new` after inspecting help. It has not been applied remotely.

1. Review with both Inventory and Finance owners. Confirm one-request/one-PO scope and the catalog-estimate audience. Verify current shared functions and roles against the definitions inspected on 2026-10-12; especially `finance_private.visible`, `creator`, `cap`, `revision_approved`, `public.finance_mutate`, `private.can_count`, `private.can_edit`, `balance_set` and `balance_sync`.
2. Confirm Inventory 004 and the phase 1 setup migration are installed, the current position-based Finance implementation is present, and its origin/deep-link route is `https://finance.frc4418.org/#po/{uuid}`. The migration fails early if core prerequisites are missing. It never rewrites Finance approval, budget, visibility or notification functions.
3. Apply to an authorized isolated staging database, not production. Do not replay the historical Inventory bootstrap migrations against the shared production schema. Do not add `inventory_purchasing` to the exposed Data API schemas or Realtime publication. Public wrappers are sufficient.
4. Run all security/model/UI tests, Supabase advisors, migration list and schema/privilege review there. Test real Auth roles and at least two simultaneous PostgreSQL sessions. PGlite verifies SQL semantics, role checks and constraints but does not model token issuance, PostgREST schema-cache behavior, real lock waits or concurrency.
5. In staging, race two request creations for the same item, two same-reference receipts, distinct receipts that together exceed the remainder, a receipt versus an inventory move, and order-recording versus Finance/profile changes. Expect no duplicate PO, no double receipt, no negative remainder, preserved item/balance equality, and bounded retryable failures rather than partial work. Recheck roles after any lock wait.
6. Review empty new tables and unchanged inventory row count, total quantities, balance sums, legacy order tags, Finance POs/approvals/budget impacts and notification counts. The migration has no seed/backfill and creates no business record.
7. Only after explicit release/migration authorization: back up, apply the additive migration, refresh the API schema cache through the normal deployment process, run read-only smoke checks and deploy the approved frontend. Do not create synthetic production POs, receipts or financial fixtures. Validate a real workflow only with separately authorized real work.
8. Frontend rollback is safe: keep the new tables/RPCs and any actual history intact. Do not drop purchasing tables or delete/“undo” real receipts as an automatic rollback. Existing inventory adjustments remain explicit audited actions. Before deleting an item referenced by purchasing history, retain it or design an archival workflow; foreign keys deliberately protect that history.

### Auth/concurrency cautions

No new credentials, policies on existing tables, user roles, Finance assignments, storage permissions or external access were changed. Advisor verification against a deployed migration is pending because this implementation is local only. Operational receiving keeps the existing active `can_count` scope. Permission changes on external profile/position rows during a truly concurrent transaction require staging verification under real PostgreSQL isolation; PGlite is not a substitute.

## Tests and fixture provenance

- `npm run test:security`: existing inventory/logistics guards plus new SQL tests.
- `npx playwright test tests/purchasing-model.spec.ts`: deterministic local demo/model tests (no browser needed by those tests).
- `npx playwright test --config playwright.purchasing.config.ts`: real-app legacy-order reconciliation smoke test plus an isolated UI harness, desktop happy path, duplicate delivery, reload persistence and mobile close/overflow checks.
- `npm run build`: strict TypeScript and Vite.

Finance v1/budget/notification fixtures are source-only local test inputs from `amsoccerman05/4418-finance` at `2fcce063a808cd192c9375a8c9c529c35c236273`. `finance-live-authority.sql` snapshots the live `creator`, position-based `cap` and `mutate_v1` definitions via read-only inspection on 2026-10-12. The base notification schema is overlaid with the current read-only `finance-live-notifications.sql` enqueue snapshot, including current approval/cancellation recipient behavior. The independent review additionally supplied `team-live-authority.sql`, preserving the active account-role filter in Team Hub’s position lookups. They are NOT deployment migrations. All test users/items/POs are synthetic data confined to PGlite, local demo storage or runner-owned disposable databases; no test connects to the shared Supabase project. The fixture Finance notification outbox is local; tests verify draft creation and receiving do not add outbox entries.

Browser execution in this workspace was attempted but blocked before any page loaded by Chromium `socket() failed: Operation not permitted`, including an approved escalation. UI scenarios are authored and pending execution in the coordinator's isolated CI. No screenshot review is claimed.

Demo state is saved as one inventory JSON snapshot so a receipt and its stock change persist together. The shared `localWrite` helper serializes all integrated demo mutations using the `inventory-demo-write` Web Lock. Purchasing fails closed in browsers without Web Locks. The phase 3 release includes the generic repository stale-snapshot protection to prevent another screen from erasing a new receipt. It is a local demonstration, not a substitute for PostgreSQL concurrency or shared authorization. Demo-only approval buttons simulate two explicitly named different people and never call production Finance.

## Current documentation checked

Supabase's 2026-10-12 changelog and the linked TLS deprecation were reviewed. The upcoming obsolete TLS cipher removal does not require changes to this modern-browser workflow. Current RLS/function guidance informs explicit grants, private definer code, fixed search paths and non-exposed tables:

- https://supabase.com/changelog.md
- https://supabase.com/changelog/cbc-tls-ciphers-deprecated
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/api/securing-your-api

The demo uses decimal-string arithmetic for quantity additions, pack conversions and remaining projections; a 0.1 + 0.2 stock-unit delivery closes an exact 0.3 request without floating-point duplicate/overreceipt artifacts.

Receipt reference normalization at the SQL boundary matches ECMAScript surrounding whitespace, including tabs, newlines and Unicode spaces, before idempotency and duplicate checks. This closes direct-RPC aliases that ordinary SQL trim would otherwise miss.

Purchasing intentionally supports at most 100,000,000 stock units per request/derived total and six decimal places. Conversion and receipt values must fit that precision; setup/request/receipt fails explicitly outside it, including a receiving balance with unsupported precision. This bounded range keeps the existing number-based Inventory UI and JSON transport from rounding away a small remainder. It does not round or rewrite existing inventory counts.

## Isolated phase 3 release branch

This release contains phase 1 setup/labels plus phase 3 purchasing only. No packing templates or tool checkout schema/UI is included. The duplicate phase 1 test fixture was removed: purchasing SQL tests load the actual checked-in phase 1 migration.

Legacy flag reconciliation is now an explicit existing-item metadata edit: use “Review legacy status” in Restock, inspect the Legacy order status selector in item details, select the reviewed value and Save changes. Cancel leaves it untouched. This changes no quantity, Finance PO or receipt. Only users already authorized to edit that item’s metadata may save it; there is no automatic clearing. A full-app Playwright test exercises the real Restock route, cancel/save behavior, retained request state and draft creation after review.

The isolated real-API runner applies the actual baseline/phase 1 migrations, schema-only Finance fixtures with current Team Hub authority and notification overlays, then phase 3. It runs both phase 1 and phase 3 suites using real disposable Auth/PostgREST and verifies the real auth.uid definition remains unchanged. The separate phase 3 native runner exercises multi-session lock races with an explicit synthetic Auth shim. Both output source SHA-256 provenance. Neither can select a hosted project or existing database.

CI runs PGlite serially to avoid parallel WASM memory pressure; native phase 1 and phase 3 races, browser full-app and component suites, and real phase 1/phase 3 API suites are included. Local native execution has no available PostgreSQL installation; real API has no established Docker/CLI stack; browser startup remains restricted. These are pending CI gates, not local passes.
