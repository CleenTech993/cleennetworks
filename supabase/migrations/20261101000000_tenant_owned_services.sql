-- Tenant-owned Daraja and SMS credentials. Ciphertext is written by the server only;
-- browser roles have no policies or grants on this table.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_provider_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_provider_check
  CHECK (provider IN ('payhero', 'intasend', 'daraja'));
ALTER TABLE public.payments ALTER COLUMN provider SET DEFAULT 'daraja';
CREATE UNIQUE INDEX IF NOT EXISTS payments_daraja_checkout_key
  ON public.payments (checkout_request_id)
  WHERE provider = 'daraja' AND checkout_request_id IS NOT NULL;

-- Platform Daraja credentials are no longer used: customer collections use tenant credentials,
-- while platform commission is paid to the platform shortcode by a separate tenant-initiated C2B.
UPDATE public.platform_mpesa_config
SET consumer_key = NULL,
    consumer_secret = NULL,
    passkey = NULL,
    validation_url = NULL,
    confirmation_url = NULL,
    callback_base_url = NULL;

REVOKE INSERT, UPDATE ON public.platform_mpesa_config FROM authenticated;
GRANT UPDATE (shortcode, updated_at) ON public.platform_mpesa_config TO authenticated;

CREATE TABLE IF NOT EXISTS public.tenant_service_secrets (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name IN (
    'MPESA_ENV',
    'MPESA_SHORTCODE',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_PASSKEY',
    'AT_USERNAME',
    'AT_API_KEY',
    'AT_SENDER_ID'
  )),
  ciphertext text NOT NULL,
  last4 text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (tenant_id, name)
);

ALTER TABLE public.tenant_service_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_service_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tenant_service_secrets TO service_role;

-- This ledger tracks platform commission owed by tenants after their direct collections.
-- The tenant initiates a separate C2B payment to the platform's configured shortcode.
CREATE TABLE IF NOT EXISTS public.platform_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  gross_amount numeric NOT NULL DEFAULT 0,
  commission_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'collected')),
  mpesa_receipt text UNIQUE,
  collected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_start, period_end),
  CHECK (period_end >= period_start),
  CHECK (gross_amount >= 0 AND commission_amount >= 0)
);

ALTER TABLE public.platform_commissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.platform_commissions TO authenticated;
GRANT ALL ON public.platform_commissions TO service_role;

DROP POLICY IF EXISTS "platform commissions super read" ON public.platform_commissions;
CREATE POLICY "platform commissions super read" ON public.platform_commissions
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "platform commissions super write" ON public.platform_commissions;
CREATE POLICY "platform commissions super write" ON public.platform_commissions
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS platform_commissions_tenant_status_idx
  ON public.platform_commissions (tenant_id, status, created_at DESC);
