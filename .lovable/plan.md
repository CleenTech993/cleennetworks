## Centralized Payments + Reconnect / Session Recovery

Two large, related changes. I'll plan both, then implement in one batch after approval.

---

### Part 1 — Centralized M-Pesa (Super Admin owns the API)

**Concept change**
Today each tenant stores `mpesa_consumer_key/secret/passkey/env` on `tenants` and `mpesa.server.ts` reads them per tenant. New model: one Daraja credential set, owned by Super Admin. Tenants only store *receiving* details (paybill / till / bank info) used for settlement display and as the `AccountReference` on STK Push.

**DB migration**
- New table `public.platform_mpesa_config` (singleton row, id=1) with: `mpesa_env`, `consumer_key`, `consumer_secret`, `passkey`, `shortcode`, `callback_base_url`, `validation_url`, `confirmation_url`, timestamps. RLS: only `super_admin` may select/update. `service_role` full.
- Add to `tenants`: `bank_name`, `bank_account_name`, `bank_account_number`, `bank_branch`, `payment_instructions text`. Keep existing `mpesa_paybill` / `mpesa_till` as tenant *receiving* identifiers (display + reference), drop usage of `mpesa_consumer_*`/`mpesa_passkey`/`mpesa_env` from app code (leave columns for now, ignored).
- New table `public.settlements`: `id, tenant_id, period_start, period_end, gross_amount, commission_amount, net_amount, payment_method, status ('pending'|'paid'), paid_at, notes, created_at`. RLS: tenant reads own; super_admin all.
- Add `platform_commission_pct numeric default 5` column to `tenants` (per-tenant override; default 5%).

**Server code**
- Rewrite `src/lib/mpesa.server.ts`:
  - `loadPlatformMpesaConfig()` reads the singleton.
  - `getDarajaToken()` / `stkPush()` take the platform config; `BusinessShortCode` = platform shortcode; AccountReference includes tenant slug + package code so callback can route.
- `src/routes/api/public/portal/$slug/checkout.ts`: switch to platform config; store `tenant_id` on the payment as today so we still attribute revenue.
- `src/routes/api/public/mpesa/callback.$tenantId.ts`: keep tenant-scoped callback URL (super-admin sets `callback_base_url` once; we still encode tenantId in the URL we generate on push).

**UI**
- New `src/routes/super-admin.payments.tsx`: edit platform Daraja credentials + callback URLs.
- Update `src/routes/tenant.settings.tsx`: remove API-credential fields; add Paybill/Till/Bank receiving fields + instructions.
- New `src/routes/super-admin.settlements.tsx`: lists settlements per tenant with gross / commission / net / status; "Mark paid" action; "Generate for period" button (SQL aggregation from `payments`).
- Extend `super-admin.billing.tsx` summary with commission earned.

---

### Part 2 — Reconnect & Session Recovery on captive portal

**DB**
- Add to `payments`: `expires_at timestamptz`, `package_minutes int` (derived at success). Already have `phone`, `mpesa_receipt`, `voucher_code`, `package_id`, `tenant_id`.
- Add to `sessions`: `device_count int default 1`, `last_login_at timestamptz`. (Used for device-limit checks.)

**New public API endpoints** (under `/api/public/portal/$slug/`):
- `POST reconnect` — body `{ phone?, mpesaCode? }`. Looks up latest successful payment for that tenant where `expires_at > now()`. Returns `{ active: true, package, expires_at, remaining_minutes, voucher_code? }` or `{ active: false, reason }`. (No password; phone or receipt is the credential — matches typical hotspot UX.)
- `GET status?phone=…` — same lookup, read-only.

**Portal UI** (`src/routes/p.$slug.tsx`)
Add tabs/buttons: **Buy Package · Reconnect · Status · Voucher · Support**.
- **Reconnect** form: phone OR M-Pesa code → calls `/reconnect`. On success shows package, time left, expiry, and a "You're online" panel (mirrors success state).
- **Status** form: phone → calls `/status`, displays active package summary + recent transactions (last 5).
- **Support** opens `mailto:` / WhatsApp link from tenant settings.

**Callback update**
When STK callback marks payment success, compute `expires_at` from `packages.duration_value/duration_unit` and persist on the payment row.

---

### Files

New:
- `supabase/migrations/<ts>_centralized_payments_reconnect.sql`
- `src/routes/super-admin.payments.tsx`
- `src/routes/super-admin.settlements.tsx`
- `src/routes/api/public/portal/$slug/reconnect.ts`
- `src/routes/api/public/portal/$slug/status.ts`

Edited:
- `src/lib/mpesa.server.ts` (platform config)
- `src/routes/api/public/portal/$slug/checkout.ts` (use platform creds)
- `src/routes/api/public/mpesa/callback.$tenantId.ts` (set `expires_at`)
- `src/routes/tenant.settings.tsx` (receiving details only)
- `src/routes/super-admin.tsx` (nav links: Payments, Settlements)
- `src/routes/super-admin.billing.tsx` (commission summary)
- `src/routes/p.$slug.tsx` (Reconnect / Status tabs)

### Notes / decisions baked in
- Default commission: **5%** (overridable per tenant). Say if you want different.
- Reconnect identity = phone **or** M-Pesa code only (no password/OTP) — standard hotspot UX. Tell me if you'd like an OTP step.
- Voucher and PPPoE reconnect already partially supported; reconnect-by-voucher just reuses the existing voucher endpoint, surfaced as a button.
- Settlement generation is manual ("Generate for period") in v1; a cron can be added later.
