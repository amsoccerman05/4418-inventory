# Student testing deployment

Repository: https://github.com/amsoccerman05/4418-inventory
Deployment branch: `4418-inventory` (workflow also runs on `main`).
Production URL: https://inventory.frc4418.org/
Pages DNS target: `amsoccerman05.github.io` (unchanged by the repository rename).
Use the custom production URL for app access and authentication.

## GitHub configuration

In repository **Settings → Secrets and variables → Actions → Variables**, create these **repository variables**:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://tuxwavmjvjfhmaddchtr.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | The public publishable key supplied for this project (also in ignored `.env.local`). |

Neither value is a private secret. The workflow also accepts the public key as a repository secret of the same name. Never put a service-role key or database password in either value.

Select **Settings → Pages → Source → GitHub Actions**. Set the custom domain to `inventory.frc4418.org`. The Actions artifact includes `public/CNAME`, but an Actions deployment still requires the custom domain configured in Pages settings. If the `github-pages` environment restricts branches, allow `4418-inventory`.

Push this branch and inspect **Actions → Deploy inventory to GitHub Pages**. The workflow validates public configuration, runs the SQL security tests, builds with TypeScript, and deploys `dist/`. It fails on missing configuration rather than publishing a demo.

## DNS — owner action only

Create exactly this record in the DNS zone for `frc4418.org`:

| Type | Host / name | Target / value |
| --- | --- | --- |
| CNAME | `inventory` | `amsoccerman05.github.io` |

Some DNS editors require the full name `inventory.frc4418.org` or a trailing dot on the target. Use DNS-only/unproxied mode while GitHub validates the domain and provisions HTTPS. Do not change `www`, the apex records, or the public site's hosting. This target was determined from the actual repository owner and live Pages hostname, not inferred from the team domain.

After DNS propagates, wait for GitHub's certificate provisioning and enable **Enforce HTTPS** in Pages settings. GitHub may temporarily redirect the underlying Pages URL to the custom domain before its DNS/certificate is ready. Check the Actions deployment result separately during that interval.

## Supabase — owner setup required

For a fresh project only, run migrations 001–003 in order, disable public signup, invite the first user and bootstrap its mentor role using the SQL in README. The existing production project already has migrations 001–005; do not rerun them. A public key cannot install this schema or manage Auth settings.

Set **Authentication → URL Configuration → Site URL** to:

`https://inventory.frc4418.org/`

Add these **Redirect URLs**:

- `https://inventory.frc4418.org/`
- `https://inventory.frc4418.org/?password-reset=1`
- `http://localhost:5173/`
- `http://localhost:5173/?password-reset=1`

If development uses `127.0.0.1`, add the two matching `http://127.0.0.1:5173/` variants. No wildcard or repository prefix is needed for production. Hash routes keep direct inventory/location links compatible with static Pages hosting. Dashboard invitation token fragments and app-requested PKCE resets are handled by the login gate.

## Live acceptance

Sign in as a mentor and explicitly add toolbox demo data or migrate the existing local V0 inventory. Invite student/lead/readonly accounts and assign roles in Admin. On two devices, check a student's quantity decrement reaches the other device, is attributed in history, and appears as Missing tools in the drawer. Verify item/drawer audit timestamps, refresh session restoration, sign-out, and actual password-reset email delivery. Local contract tests cover these app paths, but cannot prove the remote project is configured until its schema and test accounts exist.

Serialized assets, Onshape integration, invitation backend and advanced analytics remain outside this release. For setup, purchasing, packing templates and tool checkout prerequisites, use the current README and linked feature contracts.

## Enable photos, balances and trips

Migrations 004 and 005 have been applied to production. For another existing V1 workspace, follow [the owner upgrade guide](supabase/UPGRADE_LOGISTICS.md). No additional GitHub variables, DNS or Auth URL changes are required.

## Quality-of-life release order

After existing migrations 001–005, use this dependency order:

1. `20261013234406_inventory_setup.sql`
2. `20261013234530_inventory_restock_finance_receiving.sql`, after verifying the current Finance prerequisites in [the purchasing contract](docs/PURCHASING.md)
3. `20261013234533_packing_templates.sql`
4. `20261013234535_tool_checkouts.sql`

The setup migration is limited to restock policy and setup support. Verify read-only pre/post fingerprints and capability probes before deploying. Retain existing production data; do not create orders, receipts or stock changes simply to test a release. See [the setup contract](docs/setup-backend.md) for its exact invariants and rollback guidance.
