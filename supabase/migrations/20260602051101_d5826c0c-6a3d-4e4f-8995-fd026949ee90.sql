-- Tenant-scoped M-Pesa Daraja credentials
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS mpesa_consumer_key text,
  ADD COLUMN IF NOT EXISTS mpesa_consumer_secret text,
  ADD COLUMN IF NOT EXISTS mpesa_passkey text,
  ADD COLUMN IF NOT EXISTS mpesa_env text NOT NULL DEFAULT 'sandbox';

-- Payments: add voucher reference
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS voucher_code text,
  ADD COLUMN IF NOT EXISTS merchant_request_id text;

-- Routers: unique provision token
CREATE UNIQUE INDEX IF NOT EXISTS routers_provision_token_key
  ON public.routers (provision_token)
  WHERE provision_token IS NOT NULL;

-- Vouchers table
CREATE TABLE IF NOT EXISTS public.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  package_id uuid,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'unused', -- unused | used | expired
  used_at timestamptz,
  used_by_mac text,
  expires_at timestamptz,
  payment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vouchers_tenant_code_key
  ON public.vouchers (tenant_id, code);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vouchers TO authenticated;
GRANT ALL ON public.vouchers TO service_role;

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vouchers tenant access"
  ON public.vouchers
  FOR ALL
  TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

-- Helpful indexes
CREATE INDEX IF NOT EXISTS payments_checkout_request_idx
  ON public.payments (checkout_request_id);
CREATE INDEX IF NOT EXISTS payments_tenant_created_idx
  ON public.payments (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_tenant_started_idx
  ON public.sessions (tenant_id, started_at DESC);