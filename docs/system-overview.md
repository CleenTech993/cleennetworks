# CleenNetworks system overview

CleenNetworks is a multi-tenant operations platform for internet service providers. It combines an
ISP staff console, subscriber portal, router integration, customer and network operations, and
platform-level billing.

This document describes the system as it exists today, including the incremental frontend/backend
separation. It is an architecture and developer orientation, not a substitute for the feature-specific
guides linked below.

## Architecture at a glance

```text
Browser
  ├─ Existing TanStack Start web app (repository root)
  │    ├─ Tenant console, super-admin console, subscriber portal, public pages
  │    ├─ Legacy: browser Supabase queries and TanStack Start server functions
  │    └─ Legacy: HTTP API routes under src/routes/api/
  │
  └─ Migrated features ── HTTP + Supabase access token ──> apps/api (Hono / Cloudflare Worker)
                                                        └─ Supabase user-scoped client
                                                           └─ PostgreSQL row-level security

Shared HTTP request/response contracts: packages/api-contracts
Database schema and identity: Supabase
```

The web application still lives at the repository root; it has **not** yet been moved into a
`frontend/` directory. The extracted API lives in `apps/api/`. The separation is in progress:
Static IP management is the first frontend feature using the independent API, while other features
continue using the existing application and its server routes. See
[frontend/backend separation](./architecture/frontend-backend-separation.md) for the migration
conventions and next steps.

## Major product areas

- **Tenant console** — ISP operations for routers, NOC, hotspot and PPPoE, customers, packages,
  sessions, devices, inventory, payments, billing, communications, team, audit, and configuration.
- **Subscriber portal and captive portal** — public hotspot sign-in and customer access to account,
  usage, messages, invoices, and package flows.
- **Hotspot outage recovery** — router-reported session uptime supports tenant staff previewing
  and restoring remaining paid package time after a site outage. Historical recoveries are marked
  as estimates when connected-time samples are unavailable, and each payment can be recovered once.
- **PPPoE customer portal** — a separate customer sign-in at `/pppoe/{tenantSlug}` for PPPoE
  service status, usage, payment history, M-Pesa renewals, and provider support. Customers sign in
  with their PPPoE credentials; the portal session is signed and stored in an HTTP-only cookie.
- **Router integration** — RouterOS provisioning and sync, router heartbeat, connected devices,
  interfaces, inventory monitoring, and PPPoE session reporting.
- **Payments and billing** — tenant payment flows and callbacks, customer communications, platform
  billing and commissions, and super-admin settlements.
- **Customer billing** — due-time PPPoE renewal invoices with a three-day service grace period,
  M-Pesa settlement, and a tenant ledger covering invoices and prepaid payments. Package terms are
  snapshotted on each invoice.
- **Platform administration** — tenant and user administration, platform health, communications,
  audit, and NOC tools.

Feature-specific notes: [device management](./device-management.md),
[customer communications](./customer-communications.md), [Daraja / M-Pesa](./daraja.md),
[platform billing](./platform-billing.md), and
[router troubleshooting](./ROUTER_TROUBLESHOOTING.md). The device guide also documents the
M-Pesa hotspot access-code flow, legacy voucher transition, and separate RADIUS deployment plan.

## Repository map

| Path                                               | Responsibility                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/routes/`                                      | TanStack file-based pages and the existing server API routes.                                                            |
| `src/routes/tenant*.tsx`                           | Tenant-console pages and shell.                                                                                          |
| `src/routes/super-admin*.tsx`                      | Platform-administration pages and shell.                                                                                 |
| `src/routes/portal*.tsx`, `src/routes/p.$slug.tsx`, `src/routes/pppoe.$slug.tsx` | Subscriber, hotspot captive, and PPPoE customer portal pages. |
| `src/routes/api/`                                  | Existing TanStack Start HTTP endpoints: public portals, router, payment, callback, provisioning, tenant, and cron routes. |
| `src/components/`, `src/hooks/`                    | Shared React UI and browser state/auth helpers.                                                                          |
| `src/lib/`                                         | Domain logic, integrations, server functions (`*.functions.ts`), and server-only modules (`*.server.ts`).                |
| `src/integrations/supabase/`                       | Browser and server Supabase clients, generated database types, and auth middleware.                                      |
| `apps/api/`                                        | Independently runnable Hono API Worker for migrated HTTP endpoints.                                                      |
| `packages/api-contracts/`                          | Shared types and input validation for HTTP request/response payloads.                                                   |
| `supabase/migrations/`                             | Versioned Supabase/PostgreSQL migrations.                                                                                |
| `drizzle/`                                         | Drizzle schema and migrations used by the database migration track.                                                      |
| `tests/`                                           | Unit, integration-style handler, permission, and SQL migration checks.                                                   |
| `docs/`                                            | Architecture and feature guides.                                                                                         |

TanStack Router's generated route map is `src/routeTree.gen.ts`; it is generated from route files
and should not be edited by hand.

## Request and trust boundaries

### Existing application

The root application uses TanStack Start and the repository's Vite/Nitro Cloudflare build
configuration. Before separation is complete, it still serves both the web UI and much of the
backend behavior:

- Browser Supabase calls use the signed-in user's publishable-key client and are constrained by
  database row-level security (RLS).
- TanStack Start server functions in `src/lib/*.functions.ts` run backend work for the current app.
- HTTP endpoints in `src/routes/api/` serve public portal traffic, payment-provider callbacks,
  routers, and application workflows.
- Server-only Supabase service-role access is implemented in
  `src/integrations/supabase/client.server.ts`. It bypasses RLS and must stay server-side; it is
  appropriate only for trusted operations that have their own explicit authorization and scoping.

Console routes use `requireConsole()` and page-role checks. Tenant consoles require an authenticated
user with a role; MFA-enabled accounts must meet the configured second-factor assurance level. See
`src/lib/auth-guard.ts` and `src/lib/permissions.ts`. Database RLS remains the data-access security
boundary; hiding a page or navigation item is not authorization.

### Extracted API

The Hono Worker in `apps/api/` exposes versioned endpoints under `/v1/`. For a user-facing endpoint,
the frontend obtains the current Supabase access token and sends it as a bearer token. The API
validates the token and creates a Supabase client using that user's token and the publishable key.
PostgreSQL RLS then determines which tenant rows that user may read or change.

The API does not use a service-role key for user-facing operations, and it does not accept a
browser-supplied tenant ID as proof of tenant access. CORS is restricted to the configured
`FRONTEND_ORIGINS`. The health route is public; application routes require a valid bearer token.

The first migrated endpoints manage PPPoE static IP assignments:

| Method | Path                                | Purpose                                                      |
| ------ | ----------------------------------- | ------------------------------------------------------------ |
| `GET`  | `/health`                           | Worker liveness check.                                       |
| `GET`  | `/v1/tenant/static-ips`             | List PPPoE customer static IP assignments visible under RLS. |
| `PUT`  | `/v1/tenant/static-ips/:customerId` | Assign or remove a validated IPv4 address.                   |

The static IP page is still a TanStack route, but its data now travels through the HTTP client in
`src/lib/api/static-ips.ts`. The page route's visibility is limited to tenant admins and technicians;
database policies remain authoritative.

### Database and migrations

Supabase provides PostgreSQL, authentication, and row-level security. Generated database types are
in `src/integrations/supabase/types.ts`.

There are two migration tracks, and their ordering is defined by `tests/sql/build-db.sh`:

1. `supabase/migrations/*.sql`, ordered by version.
2. `drizzle/migrations/000*.sql`, inserted before the configured Supabase migration that first
   depends on Drizzle-created tables.

New Supabase migrations use `<14-digit version>_name.sql` and should be safe to re-run. After
changing a migration, regenerate the live-database verification SQL and run the SQL tests as
described in [supabase/README.md](../supabase/README.md).

## Local development

Install root workspace dependencies once:

```powershell
npm install
```

The existing web application runs from the repository root:

```powershell
npm run dev
```

To run the extracted API separately:

1. Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`.
2. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in that file. Do not use a service-role key.
3. Set `VITE_API_BASE_URL=http://localhost:8787` in the root `.env`.
4. Set `FRONTEND_ORIGINS=http://localhost:5173` in `apps/api/.dev.vars`.
5. In another terminal, run:

```powershell
npm run dev:api
```

The API's local health endpoint is `http://localhost:8787/health`. Keep local environment files
out of source control. Values prefixed `VITE_` are public and are bundled for the browser; never put
secrets in them.

## Useful commands

| Command                 | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run build`         | Production build of the existing root TanStack Start application.   |
| `npm run lint`          | Lint the repository.                                                |
| `npm exec vitest run`   | Run the Vitest suite. Add test file paths to focus it.              |
| `npm run dev:api`       | Run the API Worker locally.                                         |
| `npm run build:api`     | Dry-run bundle the API Worker.                                      |
| `npm run typecheck:api` | Type-check the API and shared contracts.                            |
| `npm run deploy:api`    | Deploy the API Worker with Wrangler credentials/configuration.      |
| `npm run db:verify-gen` | Regenerate live-database verification SQL.                          |
| `npm run test:sql`      | Validate the ordered SQL migrations and generated verification SQL. |

## Current migration status

The project is a **monorepo with a partially extracted backend**, not yet a pair of fully isolated
`frontend/` and `backend/` directories:

- The existing frontend and legacy backend remain together at the repository root.
- The new backend API is under `apps/api/`.
- Shared API contracts are under `packages/api-contracts/`.
- Static IP management is the first feature using the independent API.
- Remaining browser database features, TanStack server functions, router endpoints, callbacks, and
  other server routes still need to move incrementally.
- The final web-folder move and removal of the legacy server runtime should wait until those
  features have verified API replacements.
