# Inventory workflow verification

These tests use synthetic data only. They do not link to, reset, deploy to, or query a hosted Supabase project, and they do not read repository environment files or developer account credentials.

## Real Auth and PostgREST

Prerequisites: Node 24, Docker on the local Unix socket, and the official Supabase CLI **2.119.0**.

Run `node --test tests/integration/inventory-safety.test.mjs`, then `node tests/integration/inventory-local.mjs --run`.

The runner creates one temporary project, a new Docker network with loopback-only published ports, and fresh Auth/PostgREST/PostgreSQL services. It verifies the empty database before applying the explicit migration list in `inventory-sources.mjs`. All Auth users and inventory records are synthetic. It checks the real Auth identity function is unchanged. Local keys and session tokens are redacted, and the owned stack/network is removed even after test failures. Nothing can select an existing URL or linked project.

`--preflight` checks installed prerequisites only. `--prepare-only` checks CLI and fresh configuration preparation only. Neither option is an integration pass.

Coverage includes current role/area authorization, malicious signup metadata, count/verification separation, direct REST protections, finite threshold constraints, immutable/unique labels, read-only lookup, stale saves, parallel HTTP saves, legacy patch compatibility, atomic audit failures, and current-profile revocation using an existing Auth session.

## Native PostgreSQL concurrency

Run `INVENTORY_PG_BIN=/usr/lib/postgresql/17/bin node tests/native/inventory-concurrency.mjs` with an installed PostgreSQL bin directory.

This creates a new private Unix-socket-only cluster with no TCP listener. Its Auth identity is explicitly synthetic; it proves database locking behavior, not real Auth. Separate psql connections are held at explicit lock gates, and `pg_stat_activity` confirms competing transactions are waiting before release. It checks competing setup saves, stale retries, count/setup races in both orders, access revocation while queued, duplicate labels, and rename/label-rewrite races.

## CI and artifacts

`.github/workflows/inventory-workflows-check.yml` has independent database, browser, and real-API jobs. Browser tests still run if a database job fails. Each browser suite uses its own output directory so later runs preserve earlier screenshots. The `inventory-synthetic-browser-review` artifact contains desktop, mobile, print, and failure evidence produced by the suites. All three jobs must pass for complete verification. The phase 3 release additionally runs the actual Restock/purchasing browser integration, the phase 3 native concurrency runner and the phase 3 real-API suite.

The embedded PostgreSQL security suite and mock shared-browser suite remain useful complementary checks. Neither replaces the real Auth/PostgREST job, native concurrent-session tests, or visual review of generated screenshots.

## Phase 3 purchasing and receiving

The existing `inventory-local.mjs --run` runner applies baseline/phase 1, schema-only Finance prerequisites from `phase3-sources.mjs` (including exact live Team Hub authority and current enqueue overlays), then the phase 3 migration. Both `runInventoryIntegration` and `runPhase3Integration` must pass. The JSON report identifies each suite and hashes all migration, fixture and phase 3 harness sources.

Run `INVENTORY_PG_BIN=/path/to/postgresql/bin node tests/native/phase3-concurrency.mjs` for receipt version races, repeated final receipt IDs, delivery-reference duplicates, queued permission revocation, stock-unit changes, Finance revision changes and close-short races. It owns a fresh Unix-socket-only cluster and outputs source hashes; it does not accept a connection string or existing server. No real native/HTTP execution is claimed from syntax checks, PGlite tests or preflight failures.
