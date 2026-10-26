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

It does **not** check row data, column defaults, grants or scheduled jobs. For the scheduled job run
`select jobname, schedule from cron.job;` and expect the router liveness check.

Function bodies and check constraints are compared by definition only where a later migration **redefines one under
the same name** (today: the `admin_approve_user` function and the `platform_gateway_secrets_name_check` constraint).
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
