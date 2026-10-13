# Inventory workflow verification

These tests use synthetic data only. They never link to, reset, deploy to, or query a hosted Supabase project, and never read repository environment files or developer account credentials.

## Real Auth and PostgREST

Prerequisites: Node 24, Docker on the local Unix socket, and the official Supabase CLI **2.119.0**.

Run `npm run test:integration:guards`, then `npm run test:integration:real`.

The runner creates one temporary project, a new Docker network with loopback-only published ports, and fresh Auth/PostgREST/PostgreSQL services. It verifies the empty database before applying the explicit baseline migration list in `inventory-sources.mjs`. All Auth users, current profile/position assignments, inventory, purchase orders, notifications, trips and loans are synthetic. The Finance prerequisite list contains only reviewed schema/function copies. No notification sender is started.

In one owned stack, the runner applies and checks each upgrade in order:

1. Setup, immutable location labels and baseline logistics
2. Restock requests, real Finance draft/approval/school-submission RPCs and receiving
3. Reusable packing templates and freshly reviewed approvals
4. Tool custody, returns and reservation guards
5. A combined receipt into a checked-out location, fresh template approval, borrower return and trip pack/return regression

It verifies that real `auth.uid()` stays unchanged. Local keys and session tokens are redacted. The owned stack/network is removed after success or failure. Existing URLs and linked projects are never accepted. The success report groups checks by phase and includes SHA-256 provenance for executed migrations, fixture definitions, test modules, harness files, package scripts and CI workflow.

Use `node tests/integration/inventory-local.mjs --run --through-phase=3` to stop after restock. `--through-phase=1`, `4` and `5` are also supported; `5` is the default. Every selection creates a fresh disposable stack. Stage-only release branches need only their own phase modules.

`--preflight` checks installed prerequisites only. `--prepare-only` checks CLI and fresh configuration preparation only. Neither is an integration pass. Unknown phases and extra arguments fail closed.

Coverage includes forged signup metadata, current access/area boundaries, stale versions, direct REST protections, immutable/unique labels, read-only lookup, real revision/two-person approvals, private Finance projections, conversion snapshots, duplicate and partial/final deliveries, precision validation, exact retries, atomic audit/receipt failures, separate borrower claims, ownership preservation and existing-session revocation.

## Native PostgreSQL concurrency

With an installed PostgreSQL bin directory, run each independent runner:

```sh
INVENTORY_PG_BIN=/usr/lib/postgresql/17/bin node tests/native/inventory-concurrency.mjs
INVENTORY_PG_BIN=/usr/lib/postgresql/17/bin node tests/native/phase3-concurrency.mjs
INVENTORY_PG_BIN=/usr/lib/postgresql/17/bin node tests/native/phase4-concurrency.mjs
INVENTORY_PG_BIN=/usr/lib/postgresql/17/bin node tests/native/phase5-concurrency.mjs
```

Each creates its own private Unix-socket-only cluster with no TCP listener. Its Auth identity is explicitly synthetic; it proves database locking, not real Auth. Separate `psql` sessions are held at deterministic locks, and `pg_stat_activity` confirms each competing transaction is actually waiting before release. Later-stage runners report source hashes after successful cleanup.

- Baseline: competing setup/count saves, stale retries, queued revocation, label collisions and rename races
- Phase 3 only: competing receipts, final replay, delivery-reference duplicates, queued revocation/unit changes, Finance resubmission and receipt/close-short races
- Phase 4 only: duplicate save/approval, competing trips, stale physical reviews, reversed multi-item order, target closure and queued save revocation
- Phase 5 plus phase 4: competing checkout/movement/return/approval, independent borrower claims, reviewed-template competition and revocation at operation (including replay), item, loan and location locks

Phase 3 never imports phase 4/5 schema. Phase 4 never requires Finance or checkout schema. The combined phase 5 boundary intentionally loads phase 4 before phase 5.

## CI and artifacts

`.github/workflows/inventory-workflows-check.yml` has independent embedded-database, native-concurrency matrix, browser and real-API jobs. Native matrix failures do not cancel other phases. Browser tests still run if a database job fails; a browser install failure skips only unavailable browser execution. Each browser suite uses a separate output directory.

Artifacts:

- `inventory-synthetic-browser-review`: desktop, mobile, print and failure evidence
- `inventory-native-{inventory,phase3,phase4,phase5}`: independent native-session checks and later-stage provenance
- `inventory-real-api-and-provenance`: sequential real Auth/PostgREST checks, phase results and source hashes

All applicable jobs must pass for complete verification. Embedded PGlite SQL tests run serially to avoid memory contention. Embedded PostgreSQL and mocked browser checks remain complementary evidence; neither replaces real Auth/PostgREST, real concurrent-session execution or visual review of generated screenshots. Syntax, preparation and guard checks alone are never reported as runtime integration passes.

`npm run test:models` runs the purchasing, packing, checkout and combined state-transition regressions without starting a browser or web server. The combined checks cover loan-aware packing availability, missing/partial-return custody, restock into a loan location, stale review rejection, approval retries and independent borrower/trip returns. They also run in the database-checks job so browser installation cannot suppress them.

## Browser network isolation

All Playwright specs import `tests/browser-fixtures.ts`. Its automatic teardown fails a test after any unexpected outbound attempt, even if the app or test catches the request error. Default and extra-device contexts block service workers and allow network access only to literal `127.0.0.1` or `[::1]`; API helpers and WebSockets are guarded too. HTTP clients never follow redirects automatically, and redirect responses are rejected before the browser can follow them. Local fixtures currently need no HTTP redirects.

Explicit page-level mock responses, such as the synthetic Team Hub sign-in page, still work. The app's exact Google Fonts stylesheet is fulfilled with empty CSS so browser review uses local font fallbacks. Additional browser contexts must use `newIsolatedContext`; test routes that resume a request must use `route.fallback()` so the guard still runs.

`tests/browser-isolation.spec.ts` covers mocked gateway navigation, direct outbound attempts, second-device contexts, API helpers and HTTP redirect escapes. Its negative cases mark an expected failure only after checking the guard recorded the correct violation; the actual expected failure comes from automatic fixture teardown. Missing teardown enforcement therefore fails CI as an unexpected pass. Reserved `.invalid` destinations keep negative regressions synthetic even if a future guard breaks.
