# FRC Team 4418 Inventory

React, TypeScript and Vite inventory for students and mentors, preserving the green/white Team 4418 interface, hierarchical storage and quick drawer audits. Supabase provides shared persistence, email/password authentication, database permissions and attributed history. Local demo mode remains available.

## Photos, movement and travel upgrade

The app now supports private item/location photos, multi-location balances, atomic transfers, and competition trips with approvals, packing, internal moves, returns and explicit resolutions. Existing layout, branding and V1 workflows remain in place.

**Owner action:** apply only migrations **004** and **005**, in order, using [the upgrade guide](supabase/UPGRADE_LOGISTICS.md). The current V1 backend remains usable until setup is complete. No DNS, custom-domain or authentication changes are needed. The guide defines canonical quantities, permissions, Storage setup and live acceptance checks.

## Guided setup and location labels

The **Setup** queue shows missing/stale counts, an explicit restock decision, missing home locations, and missing units. Count each physical location separately, enter the observed quantity, and confirm that you physically counted it before **Save verified count**. Saving a restock choice never changes quantities or verification.

Choose **Restock when low** with a target above the minimum, or explicitly **Don't restock this item**. Legacy zero thresholds stay unconfigured; existing quantities are never assumed wrong. The latter choice removes the item from Restock but keeps counts and missing-tool warnings. Existing area-lead metadata permissions and student counting permissions are unchanged.

On **Locations → Print labels**, select drawers/bins (or other permanent locations) and print at **100% / actual size** on white paper. The two-column sheet uses 92 mm-wide labels with uncluttered black/white QR and Code 128 symbols. QR opens the location on a phone; the CipherLab 1500P reads the **Code 128** half. Focus **Scan location label**, scan, then press Enter if the scanner has no Enter suffix. Scanning only opens a location. Unknown, ambiguous, archived and foreign-workspace codes are rejected without mutations. Labels contain identifiers and a public app URL, never credentials; reading stock still requires the existing team sign-in.

Apply `supabase/migrations/20261012232840_inventory_setup_location_labels.sql` after existing migrations 001–005, then deploy this frontend. See [setup/label migration contract](docs/setup-label-backend.md). This additive migration leaves every prior quantity, timestamp, verification and history value intact; it adds only policy defaults and immutable generated location-label codes. Roll back the frontend rather than deleting generated identities after labels have been printed.

Physical CipherLab hardware and printer output have **not** been tested. The automated suite validates navigation, QR/Code 128 image decoding, printable layout, role permissions, stale edits and existing workflows. First print one label and verify the actual scanner cable/interface and Enter suffix before printing the full set.

## Supabase setup

1. Create a Supabase project. In its SQL editor, run these files **once, in order**, using the project owner connection:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_rls_policies.sql`
   - `supabase/migrations/003_operations_and_seed.sql`
   They create the tables, constraints, policies, transactional functions, Realtime publication entries and ten standard team areas. They do **not** insert demo inventory. For a managed migration workflow, use the Supabase CLI to apply the same migrations to your linked project.
2. In **Authentication → Providers → Email**, enable email/password and disable new user signups. There is no signup UI; disabling public signup in the project also prevents direct API signup. Invite or create users through **Authentication → Users**. New profiles default to `readonly`; user metadata cannot assign privileges.
3. Copy `.env.example` to `.env.local` and set the project URL and public anon/publishable key:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
   ```

   These settings are embedded in the frontend build. Never use a service-role or secret key. Local environment files are ignored by Git.
4. Configure **Authentication → URL Configuration**. Set Site URL to your deployed app root, including a trailing slash and repository prefix if applicable. Allow the exact app root and password-reset URL for each environment:
   - `http://localhost:5173/` and `http://localhost:5173/?password-reset=1`
   - For a project site: `https://USERNAME.github.io/REPOSITORY/` and the same URL with `?password-reset=1`.
   - Production: `https://inventory.frc4418.org/` and `https://inventory.frc4418.org/?password-reset=1`.

   Invite links use the configured Site URL. The app handles invite/recovery sessions and offers a password form. Password reset requests use the current app origin and base path. PKCE reset links should be opened in the browser that requested the reset.
5. Invite/create the first mentor. After the Auth user exists, run this owner-only SQL, replacing the email with the actual invited account:

   ```sql
   update public.profiles
   set role = 'mentor', active = true, display_name = 'Your name'
   where id = (select id from auth.users where email = 'YOUR_EMAIL');
   ```

   After the reviewed Hub Team Management rollout, use **Team Hub → Team Management** to manage existing profiles, roles, areas, registration and positions. Inventory Admin links there. Invitations remain in the Supabase dashboard. The last active admin/mentor cannot be disabled or demoted through the application.
6. With Node.js 22+ installed, run `npm ci` and `npm run dev`. Restart Vite after changing environment values. Run `npm run build` to type-check and create `dist/`; `npm run preview` serves that production build.
7. For GitHub Pages, add repository Actions variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the latter may alternatively be an Actions secret). Select **Settings → Pages → GitHub Actions**. The included workflow builds and publishes on pushes to `main` or manual dispatch. Configure these variables before deployment; the deployment workflow fails if either is missing, preventing an accidental public demo deployment.

### Current project handoff

The provided public settings are configured in the ignored local `.env.local`. A read-only check on September 8, 2026 reached the project successfully, but `public.areas` was absent from the REST schema and Auth reported public signup enabled. The owner still needs to run the three SQL migrations, disable public signup, configure Auth URLs, invite/bootstrap the first mentor, and configure GitHub Actions variables. No remote schema, account, DNS or deployment changes have been performed. The public key does not authorize those setup operations.

## Modes and data architecture

With both Supabase variables set, the shared repository is the source of truth. A partial or malformed configuration displays an error. Connection failures do not silently switch to local data. With neither variable set, or with `VITE_INVENTORY_MODE=demo`, the app uses the existing localStorage repository and demo mentor identity.

`src/services/types.ts` defines the async `InventoryRepository`, profiles, roles and events. `repository.ts` implements `LocalStorageInventoryRepository` and `SupabaseInventoryRepository`; all inventory, location, area, profile and history operations use this boundary. `mapping.ts` maps database rows to the existing domain types and preserves relationships during migration. `auth.tsx` manages session restoration, sign-in/out and recovery. `src/data.ts` retains domain models, fixtures, CSV and the isolated local snapshot adapter. `src/main.tsx` and `src/locations.tsx` preserve the existing screens and workflows.

The database contains `profiles`, `areas`, `locations`, `categories`, `inventory_items` and `inventory_events`. Items reference areas and exact locations; locations reference their parents. Events retain item names when items are deleted. `created_by`, `updated_by` and verification identities come from Auth, while historical V0 updater text is preserved separately. The existing `InventoryAsset` interface and item `trackingMode` reserve future serialized-instance support; no serialized assets are stored yet.

## Roles and database enforcement

| Role | Permissions |
| --- | --- |
| readonly | View, search and filter all team inventory, locations and restock. No writes or audits. |
| student | Readonly access plus quantity corrections, item verification and drawer audits. |
| lead | Student access plus item metadata and minimum/expected/target changes in their assigned area. Can view all areas; initial Inventory and Restock filters use their assigned area. |
| admin / mentor | Full inventory and configuration access, CSV, migration, explicit demo seed; shared member administration is in Team Hub. Mentor remains a distinct role. |

All public application tables have RLS enabled and anonymous table access revoked. Policies derive roles and area assignments from the active database profile through narrowly scoped helpers in a private schema. Inventory triggers additionally guard columns, because row policies alone cannot distinguish a student's quantity edit from a metadata edit. Moving an item across areas requires permission for both its old and new area. Browser-supplied actor IDs and privileged signup metadata are never trusted. Events are written by database triggers in the same transaction as inventory changes; clients cannot insert, modify or delete history.

Quantity buttons use an atomic server-side delta, avoiding lost increments across devices. Typed absolute counts, metadata edits and Undo use the last seen `updated_at` to reject stale overwrites. Drawer verification checks membership and row versions and saves all verification records atomically. A stale drawer must be reviewed before retrying. Invalid writes roll back with their history; the UI only adopts saved values. Realtime subscriptions are cleaned up on unmount and reconnect; focus refresh and a 30-second fallback keep data usable during disconnects. Offline writes are not queued.

Policy references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [column security](https://supabase.com/docs/guides/database/postgres/column-level-security), and [database functions](https://supabase.com/docs/guides/database/functions). Authentication follows the [official password-auth guide](https://supabase.com/docs/guides/auth/passwords).

## Migrating V0 inventory

1. Export a V0 CSV backup first. Keep the original browser storage intact.
2. Open the configured shared app using the **same browser and origin** that holds the V0 inventory, then sign in as an admin/mentor.
3. In Admin, choose **Preview local data**. Review the item, location and area counts, then **Confirm migration** and accept the explicit confirmation.
4. The migration runs as one database transaction. Legacy string IDs are mapped deterministically to UUIDs; existing UUIDs remain unchanged. Area slugs match standard shared areas, and item/location parent references are remapped together. Existing shared IDs are retained without overwriting their edited values. Repeating the migration does not duplicate records. Local data remains as a backup.

A different origin cannot read the old browser's localStorage. Migrate on the old origin before changing domains, or use demo mode there to export CSV and recreate the necessary area/location references in the destination before importing. CSV transfers items, not hierarchy definitions. Do not import legacy non-UUID IDs directly into the shared database; use the V0 migration to remap them. Admin's explicit **Add toolbox demo** similarly maps stable sample IDs and can be repeated without duplicating or overwriting examples. No demo inventory is automatically inserted into a shared project.

## Application

- Dashboard: calculated totals, all ten team areas, and items needing attention.
- Area overview: area health, categories, and filtered inventory access.
- Inventory: search and area/category/location/status/item-type/ownership filters, clickable rows, immediate quantity controls, and item detail editing. Item-name buttons provide keyboard access; quantity and location controls act independently. Each quantity adjustment shows a 10-second toast with the new count and Undo for the most recent adjustment. The timer pauses while hovered or focused. Undo never overwrites a subsequent item edit.
- Restock: area and order-status filters, current, minimum, target, amount needed, and vendor information. **Export restock list** exports only the displayed rows. Existing items default to **Needs Order**; stored/imported **Ordered** and **Received** values are supported without adding purchasing actions. Zero-stock items always appear. Amount needed is clamped to zero when no higher target is configured.
- Locations: hierarchical storage, sides, shelves, bins, and drawers, with stable parent IDs and direct location routes. Parent pages show child cards and inventory in all descendant locations. Drawer pages open directly into audit mode; **View inventory** switches to the regular searchable, filterable quantity table. Audit mode always shows every directly assigned item, regardless of inventory filters.
- Admin: add areas, categories, and hierarchical locations; configure area leads; import/export CSV; add the toolbox demo without overwriting existing records; reset demo data.

Only item name, area, category, and quantity are required. An item is GOOD above its minimum, LOW at or below minimum with a positive quantity, and OUT at zero. Verification is due when missing or older than 90 days. Use **Verify quantity** after checking an item. It immediately saves the entered quantity and `lastVerified` timestamp; other edited fields still require **Save changes**. Existing `verifiedAt` values are migrated automatically, including older CSV imports.

## CSV

Export from Admin to get a template. Exports include each item’s stable `id`. Re-import updates matching IDs, preserves area/location links, and adds only previously unseen IDs. Re-importing an unchanged export does not create copies. Legacy CSVs without an `id` column (or rows with a blank ID) still add items with fresh UUIDs. Columns omitted from a CSV preserve existing values when an ID matches. Duplicate IDs within one import and unknown area/location references are rejected before saving. CSV contains inventory records only; it does not recreate missing location/area definitions in another workspace. Required columns: `name,areaId,category,quantity`. Optional columns are included in exported files. Existing area and location IDs must be used; imported categories are added automatically. To find IDs, export the demo inventory; custom location IDs also appear in location URLs. Numeric values must be finite and nonnegative. Quoted commas, escaped quotes, and multiline notes are supported. Invalid imports are rejected in full before saving. Export before resetting or clearing browser storage.

## Tools and drawer audits

Item types are Part, Consumable, Raw Material, Tool and Asset. Ownership is Shared / School, FRC 4418 or BEST. Current quantity is the physical count; expected quantity is what belongs in the assigned drawer; minimum is the restock threshold; target is the ideal overall count. Expected is never inferred from target. A null expected count means unknown.

**Complete / Missing tools** describes physical completeness. **Low stock / Out of stock** describes supply health. Both can appear together, and a missing tool above minimum does not automatically need restocking. Open Toolbox A → TA-01 to see every directly assigned item and its current/expected count, slot and overall target. Correct a count with the buttons or by typing and pressing Enter or leaving the field. **Mark drawer verified** verifies all directly assigned items without changing expected/target counts or other drawers. Shared mode records each verification with its authenticated actor.

Demo locations include Toolbox A — Mechanical / General (TA-01–TA-15), Toolbox B — Electrical / Specialty (TB-01–TB-15), and Storage Closet with CL-L/CL-R bins. Counts are illustrative, not a verified physical audit. Before migration 004, each record has one aggregate count/location. After the upgrade, balances track each location and the original location becomes its designated home. See the upgrade guide for quantity and audit semantics.

## GitHub Pages and future custom domain

Vite uses `base: '/'` for the custom-domain root, branding URLs use `BASE_URL`, and application routes use hashes. Refreshing `/#inventory` or `/REPOSITORY/#location/UUID` stays on the static entry page. Auth callbacks return to the entry page, not a server-only route.

To move later, configure `inventory.frc4418.org` in GitHub Pages, create only that subdomain's DNS record pointing to the Pages host, enable HTTPS, and update Supabase Site URL and redirect allowlist. Do not change `www.frc4418.org` or its hosting. `public/CNAME` contains `inventory.frc4418.org` and is copied into the build. DNS remains a manual owner step. Shared database IDs remain stable across origins; browser sessions and local backups do not transfer between origins.

## Verification

```sh
npm run build
npm run test:security
npx playwright install chromium
npm run test:e2e
npm run test:shared
npm run test:logistics
```

No separate linter is configured. Build runs strict TypeScript checks. Browser tests can use an installed Chromium browser through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. `TEST_PRODUCTION=1 npm run test:e2e` tests the production demo build, including custom-domain root asset loading. The default browser suite explicitly uses demo mode regardless of local project settings.

`test:security` applies the real migration SQL in embedded PostgreSQL (PGlite) and exercises RLS, column guards, roles, attribution, stale writes, audit atomicity, hierarchy cycles and immutable history. `test:shared` runs the official Supabase JS client against a local Auth/REST/Realtime test fixture backed by the same PostgreSQL schema. It checks session persistence, protected routes, mobile quantity changes reaching a second device, actor history, role-aware controls, errors and migration. These contract tests do not replace a live-project smoke test of Supabase Auth email delivery, PostgREST and Realtime infrastructure.

After owner setup, invite a student, Fabrication lead and mentor and repeat the main acceptance scenario on two devices: start the 5/32 Allen wrench at current 4 / expected 4 / target 6, subtract once as the student, verify current 3 and Missing tools in TA-01 on the second device, and inspect the student's name and timestamp in recent activity. Check a readonly account cannot change counts, and use a password-reset email to verify the deployed redirect URL.

## V1 limitations

- No serialized asset tracking, tool checkout, full purchasing workflow, Onshape integration, invitation backend or advanced analytics.
- Location QR and Code 128 labels are supported; physical scanner hardware still needs a local smoke test.
- Order status remains a saved field/filter, not a purchasing workflow.
- History shows a concise recent subset, with no analytics or audit export UI.
- User invitations and initial privileged profile setup require the Supabase dashboard/owner SQL.
- Local demo data remains browser/origin-specific and does not synchronize across tabs/devices; its bounded local history is not an authoritative audit log. Export backups before clearing storage.
- Configuration UI supports adding areas/categories/locations and updating area leads; advanced rename/delete management remains deferred.
- No offline write queue or automatic reconciliation of stale absolute edits. Review the refreshed data and retry.
- Google Fonts is optional; system fonts are used if unavailable.

## Official branding

The official white IMPULSE rocket and wordmark from [frc4418.org](https://www.frc4418.org/) are stored in `public/branding/` (about 11 KB combined). The inspected home page linked PNG variants, not a team SVG. They retain the original transparency, proportions, and colors and are displayed on dark green. Navigation and team-area icons remain functional icons. Source URLs and provenance are recorded in `public/branding/README.md`. Branding URLs use Vite's `BASE_URL`, and the build copies the assets into `dist/branding/` for GitHub Pages, including repository subpaths.

## Acceptance checks

`tests/acceptance.spec.ts` covers removing several tools across stock thresholds, moving an item across toolbox hierarchies, duplicate Allen wrench entries, current/expected/target clarity, a 20-item mobile drawer, and an actual CSV download/re-import through Admin.

Possible duplicates are flagged in the item form, inventory rows, and drawer audit when normalized names, item types, ownership, and exact locations match. Capitalization, whitespace, and inch quote styles are normalized. Entries in different drawers or with different ownership remain separate; the warning does not block legitimate separate records or automatically combine counts.

Audit rows show **Target (overall)** separately from **Current / Expected**. Drawers with at least 15 items keep their summary and verification action visible while scrolling and provide **Next missing**, which focuses the next incomplete tool count without hiding any rows. The timed automated check measures UI navigation/correction/verification, not the time a student needs to physically count tools.

### Pending Team Management rollout

This local version removes Inventory's profile editor/write repository method. Review Hub's additive `202609120003_team_management_positions.sql` and deploy its Team Management route before publishing Inventory's redirect. Existing Inventory profile reads, assigned-area permissions, stock operations and data stay unchanged. No production migration or deployment was performed for this pass.
