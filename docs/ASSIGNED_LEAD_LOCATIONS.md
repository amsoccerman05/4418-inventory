# Scoped location and Lead item permissions

## Reviewed scope

Eligible **student or lead accounts** have a current, unrevoked assignment to an active position with one of these fixed keys:

- `business_lead`, `cad_lead`, `communications_lead`, `fabrication_lead`, `finance_lead`
- `operations_lead`, `power_lead`, `software_lead`, `strategy_lead`
- `program_manager`, `product_technical_manager` (Project Team Manager)

Account profiles must be active, email confirmed, previously signed in, and not currently banned. An inactive membership excludes the new grant. No registration-only requirement is added. Position names/categories, browser state, and user-editable Auth metadata do not grant access.

They can create normal Storage/Closet/Toolbox/Box/Side/Shelf/Bin/Drawer locations in any active area or team-wide, including children of valid active normal storage. Allowed classifications: permanent, project, robot, temporary, other. Travel, checkout, inactive or otherwise reserved ancestors (including the fixed internal Unassigned accounting location), and children of drawers/bins are excluded. Parent room is inherited. Clients cannot provide an existing ID, inactive state, trip ID, actor or timestamps.

The same eleven assignments may also **rename existing active normal locations**, including another area's locations. This changes only `name` (and the normal update timestamp), with an expected-version check; IDs, parent, children, type, classification, area, codes, items, counts and history remain unchanged. Empty/whitespace-only/control-character names and names over 200 characters are rejected. Reserved locations and ancestors are excluded. Direct table updates, bulk patch updates, deletion, photos, trips, member administration and role assignments are unchanged.

Existing account-lead project creation is preserved independently. Account-level active **Lead** accounts also inherit the already-existing Student ability to create items in any team area, including when their primary area is missing, inactive or a legacy storage area. Existing item edit/delete/photo permissions remain area-scoped; the new-item default always selects an available active team area, not a stale or storage-area ID.

The new **Edit storage settings** control uses existing admin/mentor rights (`is_admin` / `isAdmin`), not assigned-lead rights. The baseline locations ALL policy already permits those accounts to update location type/classification. The constrained action changes only physical type and storage use, protects reserved/inactive locations, checks the expected version, and prevents converting a parent with children into a Drawer/Bin. It does not move items or recreate locations. The UI separates physical **Location type** (including Box, Toolbox, Closet) from **Storage use** (Permanent storage, Project, Robot, Temporary, Other) and **Owner team area**.

## Exact migrations and boundary

`supabase/migrations/20261028011601_assigned_student_lead_location_creation.sql`

1. Adds `private.can_create_assigned_lead_location()` (self-bound read-only authorization; fixed search path; privileged lookup only in private schema).
2. Adds `public.inventory_location_creation_context()` (security invoker; authenticated-only self capability; no position roster or Auth details exposed).
3. Adds `private.create_assigned_lead_location(jsonb)` (security invoker; API roles cannot execute it directly). It rechecks authorization, serializes with Team Management/hierarchy changes, validates input and inserts a new normal location.
4. Adds only a guarded dispatch branch inside the existing `inventory_action(text,jsonb)` function. The migration obtains its current definition and aborts unless the expected insertion point occurs exactly once, preserving unrelated deployed branches. All table policies/grants, existing triggers, data, shared roles and assignments remain unchanged.

The follow-on migration `supabase/migrations/20261028020701_normal_location_types_and_rename.sql` extends the normal type constraint/helper, adds private name-only rename and existing-admin settings helpers (both security invoker, fixed search path, not directly executable by API roles), and inserts narrowly guarded dispatcher branches without replacing unrelated code. All new writes validate server-side authority and state; no table policy or role changes occur.

`supabase/migrations/20261028020953_lead_item_creation.sql` only replaces `private.can_create_item(uuid)` so active Lead accounts inherit Student create-item permission. It preserves the existing invoker mode, search path and ACL, and does not change `can_edit`, item guards, balance accounting, photo permissions or any policies.

The UI reads the capability separately from profile and inventory refresh. It fails closed, aborts after five seconds, refreshes on focus/every 30 seconds, and closes the modal when eligibility/identity/scope changes. Authorization is rechecked by the server for every create/rename; cached capability is never sufficient. Profile deactivation refresh cannot be stalled by the optional request.

## Release requirements

**The earlier create-only approval does not cover the expanded release. Do not apply the three migrations, publish expanded changes, merge or deploy without explicit approval of this combined permission scope and release.**

- Base branch: `4418-inventory` (not legacy `main`).
- Shared Supabase project: `tuxwavmjvjfhmaddchtr`.
- Read current function definitions and migration ledger again immediately before applying; coordinate with any concurrent Hub rollout. Do not reset or copy another migration's definition.
- Requires Inventory migrations 001–005 plus the existing shared Hub position/membership tables and Auth readiness columns.
- Run `npm run build`, `npm run test:unit`, `npm run test:security`, `npm run test:shared`, `npm run test:logistics`, and `npm run test:e2e` on the exact release commit. The existing full-suite PR workflow now includes the permission-related paths.
- Local build/unit/security checks pass. Local browser execution is blocked before tests by Chromium IPC restrictions; a justified elevated retry was blocked by environment setup. Browser test collection succeeds, but collection is not execution. Require passing permitted browser CI before merging or deploying.
- Apply only these three migrations in their listed order after approval, verify functions/ACLs and preserved policies, then deploy the UI. Do not create synthetic accounts/locations in production. A missing migration safely leaves the additional student UI disabled.

If an approved emergency rollback is needed, the two grants can be disabled independently: restore the prior create-item predicate to remove only the added Lead item creation, and replacing the private predicate's body with `select false` disables only the new position-based create/rename grant and UI while retaining existing locations and old lead/admin/mentor behavior. Do not delete created locations or alter member assignments. Review and approve the exact rollback before applying it.

## Privacy review

This uses existing account readiness, membership and assigned-position data solely for role-based access. It adds no personal-data columns, audience for existing records, external service, sharing destination or retention rule. The canonical notice already describes accounts, membership, leadership positions and feature-specific permissions. Keep the existing canonical privacy links; no copied notice or student roster belongs in this repository.
