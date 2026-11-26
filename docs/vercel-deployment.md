# Deploying the web app to Vercel

The root TanStack Start app is server-rendered and includes application API routes and server
functions, so deploy it as a Vercel application rather than as a static Vite site. The Vercel
environment automatically selects Nitro's Vercel preset; Cloudflare builds continue using the
existing Cloudflare adapter.

## Deploy

1. Import this repository into Vercel and set the project root to the repository root.
2. Use `npm install` as the install command and `npm run build` as the build command. Leave the
   output directory unset so Nitro can provide Vercel's deployment output.
3. Add the environment variables below for each Vercel environment you will use, then redeploy.
4. Add your production domain in Vercel and set `APP_CANONICAL_HOST` and
   `VITE_APP_CANONICAL_HOST` to that hostname.
5. In Supabase Auth, set the site URL and redirect allow-list to include your Vercel domain. Test
   sign-in, MFA, customer portals, callbacks, and router integrations after deployment.

## Environment variables

Set these in Vercel's **Project Settings → Environment Variables**:

| Name | Scope | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Server | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Server | Publishable key used by server-side auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Server secret | Server-only admin operations; never expose to the browser |
| `VITE_SUPABASE_URL` | Build and browser | Supabase project URL embedded in the app |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Build and browser | Public Supabase key embedded in the app |
| `APP_CANONICAL_HOST` | Server | Your app's canonical hostname, without `https://` |
| `VITE_APP_CANONICAL_HOST` | Build and browser | Same hostname, embedded in the app |
| `VITE_API_BASE_URL` | Build and browser | Origin of the separately deployed API Worker, if using its static-IP endpoints |

`VITE_` values are public. Do not put secrets in them. Configure optional services only when used:
for example, `PLATFORM_SECRETS_KEY` for encrypted provider credentials, `SMTP_*` for email, and
`CRON_SECRET` for the platform billing job. Keep existing secret values stable when moving hosting.

## Supabase and the separate API

Vercel hosts the root web app, not the independent API Worker in `apps/api/`. Keep that API on
Cloudflare Workers (or deploy it to a compatible service) and set `VITE_API_BASE_URL` to its
origin. Configure its allowed frontend origin for the Vercel domain. The app still requires a
reachable Supabase project with its schema, users, and data; moving the web app does not migrate
Supabase. See [the Cloudflare deployment guide](./cloudflare-deployment.md) for the API Worker and
[the Supabase guide](../supabase/README.md) for database migration checks.
