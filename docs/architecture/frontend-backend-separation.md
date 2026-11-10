# Frontend/backend separation

For an overview of the whole system and local setup, see [system overview](../system-overview.md).

## Target

Keep the repository as a monorepo with independently deployable applications:

- `apps/web` owns browser UI and presentation.
- `apps/api` owns authenticated business endpoints and server-only integrations.
- `packages/api-contracts` owns request and response types shared over HTTP.
- Supabase remains the identity provider and database. The browser sends the signed-in user's access token to the API; API database requests use that user token so database row-level security continues to enforce tenant access.

The API must not expose the Supabase service-role key to the browser. Do not add a service-role fallback to user-facing endpoints.

## Migration in progress

The existing TanStack Start application at the repository root still hosts its routes, server functions, and legacy browser-to-Supabase features. Move feature slices one at a time; don't remove a legacy endpoint until all its consumers have moved and its replacement has been verified.

The first migrated slice is tenant static IP management:

- API: `apps/api/src/index.ts`
- Shared HTTP data contracts: `packages/api-contracts/src/static-ips.ts`
- Frontend API client: `src/lib/api/static-ips.ts`
- Frontend page: `src/routes/tenant.static-ips.tsx`

New browser-facing backend requests should go through a typed client in `src/lib/api/`, send the Supabase access token as a bearer token, and have the API use a user-scoped Supabase client. Keep tenant authorization in database RLS policies; never trust a tenant ID supplied by the browser.

## Local development

1. Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` and fill in the Supabase URL and publishable key. Never put a service-role key in the frontend.
2. Set `VITE_API_BASE_URL=http://localhost:8787` in the root `.env`.
3. Run `npm run dev:api` and `npm run dev` in separate terminals.
4. Configure `FRONTEND_ORIGINS` with the exact deployed frontend origins before deploying the API.

Useful scripts: `npm run build:api` and `npm run deploy:api`.
For deployment, configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `FRONTEND_ORIGINS` as
Worker variables. The publishable key is not a service-role key.

## Next migration steps

1. Move authenticated tenant workflows from browser Supabase queries/server functions to API endpoints.
2. Move public callbacks and router-facing endpoints to the API without changing their paths until clients are updated.
3. Once no feature depends on TanStack Start server behavior, move the browser app under `apps/web` and deploy it independently.
4. Remove legacy server functions and API routes only after endpoint and integration tests cover their replacements.
