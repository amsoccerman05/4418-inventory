# Reusable competition packing templates

## Workflow

In a trip's **Manifest**, a lead, admin or mentor can name and **Save planned kit**. This creates an immutable snapshot of the intended item quantities and source-location hints. Partial packing, internal moves and returns split existing manifest rows; summing by item/home reconstructs the intended list without double counting. Resolved allocations remain part of that original plan and can be removed or reduced during the next review.

On a trip in **planning** or **packing**, choose a saved template or a **closed previous trip** and select **Review planned kit**. Copying an open/returning/cancelled trip directly is rejected. Every destination starts blank because previous trip locations are no longer valid destinations.

Review each quantity, source and destination. The panel shows the current source balance, already-approved quantities across active trips, and the remainder available. Quantities can be changed and rows removed. Confirm the review checkbox, then choose **Approve reviewed kit**. This calls the existing manifest approval operation for each reviewed line in one transaction. It does not physically pack stock. A student or other counting role then uses the existing **Pack**, movement, return and resolution controls.

Save uses the original intended plan, not only currently outstanding returns. It never stores packed/returned/resolved status, resolution notes, historical ownership, movement records, approval records or actual balances. New approvals use current item ownership and new approval IDs.

## Integration

`PackingTemplates` in `src/packing-templates.tsx` is a drop-in panel:

```tsx
<PackingTemplates key={trip.id} db={db} profile={profile} tripId={trip.id} refresh={refresh}/>
```

The integration is inside the existing Manifest section of `Travel` in `src/logistics.tsx`. There are no `main.tsx`, route, trip-state or existing approval API changes. The only model extension is optional `Logistics.packing` for demo persistence. Shared data uses the independent `packingRepository` service. Existing inventory live refresh/focus/poll behavior reloads template choices; templates need no change to existing Realtime publications.

Demo save/approval wraps the complete reread → mutation → save sequence in shared `localWrite(..., true)` using the `inventory-demo-write` Web Lock. It fails closed if safe cross-tab locking is unavailable. It does not reuse a snapshot read before the lock.

## Database and permissions

Apply `supabase/migrations/20261012232702_packing_templates.sql` after the existing logistics migration 004 (005 is part of the supported current baseline). The original filename was generated with Supabase CLI `migration new packing_templates`, after discovering its help. This recovery retains that migration identity; no remote migration was applied during implementation or recovery.

The migration adds:

- Public `packing_templates`, immutable to clients, with authenticated active-member read RLS
- Private, actor-bound `packing_template_requests` idempotency receipts
- Private security-definer `packing_template_action` with a fixed empty search path and explicit active role checks
- Public security-invoker wrapper `packing_template_action`, executable only by authenticated users
- Source/creator and pending-approval indexes
- Private `packing_external_reserved(item, location)` hook, returning zero until phase 5 overrides it with outstanding tool-loan reservations; it has no public, anonymous or authenticated direct execution grant

The existing approval policy is preserved: any active lead, admin or mentor can approve a trip manifest. It is not area-scoped in the existing `inventory_action` implementation. Students and readonly users cannot save or approve templates; inactive users cannot read them. Existing metadata editing remains area-scoped. No role assignments, storage or existing permission policies change.

Saving and applying are atomic and request-ID idempotent. Replaying the exact request as the same actor returns the saved result; changing its payload rejects it. A separate actor cannot reuse another actor's receipt. The UI retains the request ID for unchanged retries, disables active requests, and resets review state on trip navigation. Save data is built from server-side manifest rows, never from untrusted copied status fields.

Approval locks the target trip and then item rows in deterministic order, matching the existing movement lock order. All quantities, source membership, active home/destination, trip phase, current item/balance timestamps, and aggregated source availability are validated before any new approval is made. Outstanding approvals and the external-reservation hook count against availability. The existing `inventory_action('approve')` provides attribution/history. Failures roll back every approval and the receipt. Approvals are plans, not inventory reservations: physical packing still rechecks actual stock through the existing operation.

Active manager authority is rechecked after the request advisory lock, after the source-trip/source-list wait before save, and after all item/location waits before approval. A caller demoted while queued cannot rely on the initial permission check. Phase 5 integrates loan availability into the frontend through its shared `loanQuantityAt` helper and also enforces cumulative loan/manifest reservation checks in database guards.

This migration is additive. It neither rewrites existing manifests nor calls physical inventory movement. Do not rerun it or manually remove receipt rows. Reverting the frontend hides the new panel without disturbing existing trips or stock.

## Verification

Local checks completed after recovery:

- `npm run build`
- `node --test tests/packing-security.test.mjs`: nine actual-PGlite scenarios for roles, planned-state-only copies, atomicity, idempotency, stale state, source/target restrictions, and cumulative external-reservation preflight
- `npx playwright test --config playwright.packing-shared.config.ts`: shared HTTP/Auth/PostgREST contract against actual PGlite SQL and RLS, full save → reviewed approval → pack → return → close flow
- `npx playwright test --config playwright.packing.config.ts --grep 'demo model'`

Browser scenarios are implemented in `tests/packing/templates.spec.ts` and available via `npx playwright test --config playwright.packing.config.ts`. They cover mobile sizing, save, review/cancel, destination reselection, availability warnings, explicit confirmation, double-click protection, physical packing separation and Back navigation. Browser execution in the original executor was blocked before page launch by its Chromium socket restriction. No screenshots or browser pass are claimed here; CI should execute these tests with its supported Chromium install.

The shared fixture is local-only (`TEST_PACKING=1`, test accounts, PGlite). It does not contact production. Real PostgreSQL multi-connection race behavior and hosted Supabase advisors are not exercised by this fixture. Run authorized staging smoke tests after migration, including two simultaneous reviewers, authority revocation while queued, loan reservations and a stock move between review and approval.
