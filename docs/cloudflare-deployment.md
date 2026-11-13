# Deploying the web app to Cloudflare Workers

The root TanStack Start app builds to `.output/` using the existing Cloudflare-compatible Nitro
adapter. `wrangler.toml` deploys that server entry and its static assets as one Worker. The separate
API Worker under `apps/api/` is not a replacement for the root app; many server functions, router
sync endpoints, public portals, and callbacks still run in the root app.

## Important: keep Supabase available

Moving the app to Cloudflare does not migrate or replace Lovable Cloud's Supabase database or Auth.
The app requires a reachable Supabase project with its schema, users, and data. Do not delete the
Lovable project or revoke its access until the database and Auth have been migrated and verified.
If Lovable has paused the project, deploying the app alone will not make sign-in or customer
features work.

Create a destination Supabase project, migrate the schema and data, configure Auth URLs and email,
then verify logins and tenant data before switching the app. Follow `supabase/README.md` for the
ordered SQL migration process. Database, Auth, Storage, and payment callbacks need separate
cutover checks.

## Build and deploy

1. Put the domain's DNS zone on Cloudflare. Do not remove existing email or other DNS records while
   changing nameservers.
2. Install dependencies with `npm install`, then authenticate Wrangler with `npx wrangler login`
   (or use a Cloudflare API token with Worker deployment permissions in CI).
3. Configure the Worker variables/secrets below.
4. Build and deploy with `npm run deploy:web`. For a bundle-only check, run `npm run build`
   followed by `npm run build:web:worker`.
5. In Cloudflare, open **Workers & Pages → cleennetworks-web → Settings → Domains & Routes** and
   add `hotspot.ziwatti.ac.ke` as a custom domain. Cloudflare creates the DNS record and certificate.
6. Configure Supabase Auth's site URL and redirect allow-list for `https://hotspot.ziwatti.ac.ke`,
   then test login, portal access, router sync, and payment callbacks.

The custom hostname must be in an active Cloudflare zone. If the subdomain currently points to
another host, plan the DNS cutover and keep the old deployment available for rollback.

## Configuration

Set these in the Cloudflare dashboard under the Worker’s **Settings → Variables and Secrets**:

| Name | Type | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Variable | URL of the destination Supabase project |
| `SUPABASE_PUBLISHABLE_KEY` | Variable | Supabase browser/server publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Server-only Supabase service-role key |
| `APP_CANONICAL_HOST` | Variable | `hotspot.ziwatti.ac.ke` for server-side domain verification |

Set these as build environment variables in the Cloudflare build pipeline (or in the shell before
building locally):

| Name | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Public Supabase project URL embedded in the browser app |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public publishable key embedded in the browser app |
| `VITE_APP_CANONICAL_HOST` | `hotspot.ziwatti.ac.ke` |
| `VITE_API_BASE_URL` | URL of the separately deployed API Worker if using its static-IP endpoints |

The publishable key is intended for browser use; the service-role key is not. Never use a `VITE_`
prefix for a secret. Additional optional services (M-Pesa platform callbacks, email, AI, and
platform billing) need their respective server secrets configured separately; see `docs/` and
`supabase/README.md`.

Cloudflare Workers Free has a daily request allowance and a per-request CPU limit. Check current
Cloudflare plan limits against expected customer and router traffic before relying on the free tier
for production.
