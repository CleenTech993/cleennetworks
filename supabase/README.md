# Database migrations

## How the database is built

There are **two migration tracks**, and they depend on each other:

| Track    | Folder                        | Applied by                                                                                | Contents                                          |
| -------- | ----------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Supabase | `supabase/migrations/*.sql`   | whatever deploys your Supabase migrations (Lovable or the Supabase CLI), in version order | almost everything                                 |
| Drizzle  | `drizzle/migrations/000*.sql` | applied separately (Lovable's `LOVABLE_DB_MIGRATION_URL`)                                 | `router_metrics`, `router_interfaces` and related |

The drizzle migrations need `routers` and `customers` (an early Supabase migration), and the Supabase migrations
from `20261024000000_role_based_access.sql` onward need `router_metrics`. So the real order is: Supabase
migrations in version order, with the three drizzle ones slotted in just before `20261024000000`.
`tests/sql/build-db.sh` encodes this order and is the single source of truth. `npm run test:sql` builds a fresh
Postgres from it and runs the access-rule and feature tests.

A database built from only `supabase/migrations/` (for example a plain `supabase db reset`) fails at
`20261024000000` because `router_metrics` does not exist yet. Apply the drizzle files first, as above.

## Is the live database up to date?

You cannot tell from the migration files alone, so there is a read-only check you run **against the live database**:

1. Open the Supabase dashboard, then **SQL Editor**, then **New query**.
2. Paste the whole of [`verify_live_db.sql`](./verify_live_db.sql) and run it. It changes nothing.
3. Read the `status` column, one row per migration:

| status        | meaning                                                                                    | what to do                                                   |
| ------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `OK`          | every table, column, function, policy, trigger and index that migration creates is present | nothing                                                      |
| `NOT APPLIED` | none of its objects exist                                                                  | apply that migration and every later one, in order           |
| `PARTIAL`     | some objects are missing (cut short, or changed by hand)                                   | see `missing_objects`, then re-run the migration (see below) |
| `n/a`         | it only changes grants, data or defaults, so there is nothing to look up by name           | nothing                                                      |

It matches objects by **name**. If one of the old June migrations (the ones that can't be re-run, below) ever shows
`PARTIAL` for an auto-generated name such as a `_pkey` or `_fkey`, don't re-run it: open that table in the Table Editor
and compare first, because the table may have been created through the dashboard and named differently.

It does **not** check row data, column defaults, grants or scheduled jobs. For scheduled jobs run
`select jobname, schedule from cron.job;` and expect the router liveness check and stale STK payment cleanup.

Function bodies and check constraints are compared by definition only where a later migration **redefines one under
the same name** (today: the `admin_approve_user` function and the `payments_provider_check` constraint).
Those show up in `missing_objects` as `funcdef` / `constraintdef` and mean "this object doesn't have the definition
from that migration": either the migration wasn't applied or the object was edited by hand. Compare the definition
before overwriting it.

### Bringing it up to date

- **Supabase migrations:** let your pipeline apply them, or paste the file into the SQL Editor. Apply in version
  order and never skip one.
- **Re-running is safe** for every migration from `20261023000000_lock_profiles_columns.sql` onward (they use
  `IF NOT EXISTS` and drop-before-create), so if one of those shows `PARTIAL`, just run the whole file again.
  Four of the June 2026 migrations (`20260531141120`, `20260604053624`, `20260605010055`, `20260606012419`) and
  `drizzle/0000`, `0001` are **not** re-runnable; they were applied long ago and should read `OK`.
- **Drizzle migrations** go through the same Lovable path as before. Do not paste them out of order.
- Never edit a migration that has been applied, other than to make it re-runnable.

## Known differences between the live database and the migrations

- `routers.wg_public_key`, `wg_tunnel_ip`, `wg_last_handshake_at` exist in the live database (and in
  `src/integrations/supabase/types.ts`) but no migration creates them. They were added directly on 2026-10-02 for
  WireGuard, which was removed on 2026-10-03, and nothing in the app uses them. A database rebuilt from the
  migrations simply doesn't have them. Leaving them is harmless. To remove them (irreversible; back up first):

  ```sql
  alter table public.routers
    drop column if exists wg_public_key,
    drop column if exists wg_tunnel_ip,
    drop column if exists wg_last_handshake_at;
  ```

- `types.ts` is generated from the live database. It was last regenerated before the helper functions
  `has_tenant_role`, `is_aal2`, `tenants_with_role` and `check_router_liveness` existed. They are not called
  through the typed client, so nothing is broken; regenerating the types would add them.

## Adding a migration

1. Name it `<14-digit version>_name.sql` with a version later than every existing one. Any other name is rejected.
2. Make it safe to run twice (`create table if not exists`, `create index if not exists`,
   `drop policy if exists` / `drop trigger if exists` before `create`, `create or replace function`).
3. Run `npm run db:verify-gen` to regenerate `verify_live_db.sql`, and `npm run test:sql`. The test run fails if
   the generated file is out of date, or if it disagrees with a database built from the migrations.
4. Commit the migration and the regenerated file together.

`npm run db:verify-gen` and `npm run test:sql` need a Postgres they can create databases in (set `PGHOST` and
`PGUSER`); they never touch your Supabase project.

## Customer documents

`20261206000000_customer_documents.sql` creates the private `customer-documents` Storage bucket.
Files are stored under `<tenant_id>/<customer_id>/`, limited to 10 MB, and restricted to PDF,
image, and Word document MIME types. Storage policies require an AAL2 session and tenant admin,
technician, or support-staff membership for the customer’s tenant. The bucket is private; the
customer profile creates short-lived signed download links rather than exposing public URLs.
Supabase Storage already enables RLS on `storage.objects`; the migration adds bucket-specific
policies without attempting to alter that managed table.

## Support ticket priority

`20261207000000_ticket_priorities.sql` adds the `low`, `normal`, `high`, and `urgent` priority
levels to support tickets. New tickets default to `normal`; the database constraint rejects
unsupported priority values.

`20261208000000_ticket_assignment.sql` lets tenant admins assign support tickets to tenant admins,
technicians, or support staff. A database trigger validates both the actor’s permission and the
assignee’s tenant membership.

## Inventory warranties

`20261209000000_inventory_warranty_dates.sql` adds an optional warranty expiry date to each tracked
device. Staff can record it in Inventory; expired warranties and those expiring within 30 days are
flagged for follow-up.

## Tenant payment credentials

From `20261101000000_tenant_owned_services.sql`, customer payments use tenant-owned Daraja STK
credentials. The encrypted `tenant_service_secrets` table is server-only; never grant browser roles
access to it. `20261102000000_daraja_only.sql` removes platform gateway selection and encrypted
gateway secrets. New payments use Daraja only; outstanding payments from the retired gateways are
marked failed, and completed historical records remain available for reporting. Super admins manage
only the platform's C2B receiving shortcode. Tenants pay platform commission by separate C2B transfer;
`platform_commissions` records the amount due and the manually confirmed M-Pesa receipt.

Pending STK attempts older than ten minutes are marked failed every five minutes by
`expire_stale_stk_payments()`. Checkout also expires stale attempts for that phone and reuses an active
pending prompt, which avoids issuing a duplicate prompt after a captive-portal refresh. Failed payment
rows are retained for audit and reporting. The scheduled sweep requires `pg_cron`; without it, checkout
expires stale attempts when that phone starts another payment, and the status endpoint expires them
while the customer is still waiting.

## Mandatory MFA for console access

`20261104000000_mandatory_mfa.sql` changes `public.is_aal2()` so authenticated business-table
access always requires a second-factor (`aal2`) session, including for users who have not enrolled
an MFA factor yet. Tenant and super-admin console routes send users without a verified factor to
the required enrollment flow; password-only sessions cannot access business data. Apply this
migration after the optional-MFA migration and regenerate `verify_live_db.sql` using the steps above.
Tenant admins can reset MFA for other users in their tenant from Team; super admins can reset any
other account from Users. A reset removes the user's factors and revokes their active sessions, but
does not disable the MFA requirement: the user must enroll and verify a new factor before console
access is restored.

The application does not impose a failed-password lockout or attempt limit. Repeated failures and
sign-ins from new locations are still recorded as security alerts. Supabase Auth may independently
rate-limit sign-in requests.

Users can manage their own active sessions from tenant Settings: signing out other sessions keeps
the current browser active, while signing out all devices revokes every session and returns the
current browser to sign-in. These actions are recorded in the audit log.

The login protection migration stores only HMAC fingerprints of normalized email addresses and
client IPs. Five failed password attempts for an email or twenty for an IP within fifteen minutes
temporarily block sign-in until the rolling window expires. A successful sign-in clears failures
for that email. Repeated failures and a returning account signing in from a new IP create security
events in the existing audit log for super-admin review.
This only protects the application's sign-in flow; direct calls to Supabase Auth do not pass through
these counters, so keep Supabase's provider-side rate limits enabled and use edge/WAF controls where
available.

## Tenant customization and custom domains

`20261128000000_tenant_customization.sql` adds tenant branding labels, per-user preferences, and
tenant-owned hotspot and console domain registrations. Set `APP_CANONICAL_HOST` in the application
server environment and `VITE_APP_CANONICAL_HOST` to the same hostname when building the frontend.
The app's canonical host must resolve to the deployment.

For each custom domain, the tenant admin adds the displayed `_netgrid-verify.<domain>` TXT token and
a CNAME from the domain to `APP_CANONICAL_HOST`, then runs verification in Settings. Verification
proves DNS ownership and checks the CNAME; it does not provision HTTPS or configure routing. The
self-hosted reverse proxy must route each verified host to this app, serve a valid certificate for
it, and overwrite `X-Forwarded-Host` with the actual incoming host (do not trust a client-supplied
forwarded-host header). Use DNS-only CNAME records during verification; DNS proxying or flattening
may hide the CNAME and prevent verification.

Add custom console domains to Supabase Auth's allowed redirect URLs (for example
`https://console.example.com/**`). Custom hostname routing is resolved by the app's public domain
lookup; tenant console access still requires the user's normal tenant membership, role, and MFA.
Apply the migration using the standard migration instructions above and run both
`npm run db:verify-gen` and `npm run test:sql`.

## PPPoE fair usage

`20261107000000_pppoe_fup_usage.sql` adds per-package PPPoE data allowances and reduced upload/download
speeds. The router agent attempts to report session byte counters every two minutes; the database
accumulates counter deltas and blocks browser edits to usage values. Usage resets when a package is
changed or its expiry is extended. A customer switches to the package's FUP profile at the next
router sync after reaching the allowance. If a router does not expose session counters, it continues
reporting connectivity but cannot accumulate usage for FUP enforcement.
