
-- 1) Platform M-Pesa config (singleton)
CREATE TABLE IF NOT EXISTS public.platform_mpesa_config (
  id int PRIMARY KEY DEFAULT 1,
  mpesa_env text NOT NULL DEFAULT 'sandbox',
  shortcode text,
  consumer_key text,
  consumer_secret text,
  passkey text,
  callback_base_url text,
  validation_url text,
  confirmation_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton_row CHECK (id = 1)
);
INSERT INTO public.platform_mpesa_config (id) VALUES (1) ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON public.platform_mpesa_config TO authenticated;
GRANT ALL ON public.platform_mpesa_config TO service_role;
ALTER TABLE public.platform_mpesa_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform mpesa super read" ON public.platform_mpesa_config
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));
CREATE POLICY "platform mpesa super update" ON public.platform_mpesa_config
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "platform mpesa super insert" ON public.platform_mpesa_config
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));

-- 2) Tenant receiving / settlement fields
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_branch text,
  ADD COLUMN IF NOT EXISTS payment_instructions text,
  ADD COLUMN IF NOT EXISTS support_phone text,
  ADD COLUMN IF NOT EXISTS support_email text,
  ADD COLUMN IF NOT EXISTS platform_commission_pct numeric NOT NULL DEFAULT 5;

-- 3) Settlements
CREATE TABLE IF NOT EXISTS public.settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  gross_amount numeric NOT NULL DEFAULT 0,
  commission_amount numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'mpesa',
  status text NOT NULL DEFAULT 'pending',
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.settlements TO authenticated;
GRANT ALL ON public.settlements TO service_role;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settlements tenant read" ON public.settlements
  FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));
CREATE POLICY "settlements super write" ON public.settlements
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 4) Payments: expiry + denormalized phone+receipt lookups (idx)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS payments_phone_idx ON public.payments (tenant_id, phone);
CREATE INDEX IF NOT EXISTS payments_receipt_idx ON public.payments (tenant_id, mpesa_receipt);
