-- CleenNetworks fresh Supabase schema installation
-- Generated from the canonical order in tests/sql/build-db.sh.
-- Run ONLY against a new, empty Supabase project. This creates schema, not users or app data.
-- Includes repository migrations dated through 2026-12-14; verify they match the app version you intend to deploy.
-- Supabase-managed auth, storage, roles, and publications are expected to exist.

-- BEGIN MIGRATION: supabase/migrations/20260531141120_a368e0f5-5bf5-456d-9536-c884d0cde707.sql

-- Roles enum
CREATE TYPE public.app_role AS ENUM ('super_admin','tenant_admin','technician','billing_agent','support_staff','end_user');

-- Tenants
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  logo_url text,
  primary_color text DEFAULT '#0ea5e9',
  subdomain text UNIQUE,
  status text NOT NULL DEFAULT 'active',
  mpesa_shortcode text,
  mpesa_paybill text,
  mpesa_till text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Profiles (1:1 with auth.users)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  phone text,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Roles (separate table — never on profiles)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, tenant_id)
);

-- Security-definer helpers (avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.user_tenant_id(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = _user_id
$$;

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ISP domain tables
CREATE TABLE public.routers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  model text,
  serial text,
  routeros_version text,
  public_ip text,
  mac_address text,
  status text NOT NULL DEFAULT 'pending', -- pending|online|offline|provisioning
  provision_token text UNIQUE,
  provision_token_expires_at timestamptz,
  last_seen_at timestamptz,
  cpu_usage int,
  ram_usage int,
  uptime_seconds bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  kind text NOT NULL DEFAULT 'hotspot', -- hotspot|pppoe|voucher
  price numeric(10,2) NOT NULL DEFAULT 0,
  duration_value int,
  duration_unit text, -- minutes|hours|days|weeks|months
  data_limit_mb bigint,
  unlimited boolean DEFAULT false,
  upload_kbps int,
  download_kbps int,
  burst_kbps int,
  device_limit int DEFAULT 1,
  simultaneous_logins int DEFAULT 1,
  idle_timeout_sec int,
  session_timeout_sec int,
  mac_binding boolean DEFAULT false,
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  email text,
  customer_type text NOT NULL DEFAULT 'hotspot', -- hotspot|pppoe
  pppoe_username text,
  pppoe_password text,
  static_ip text,
  status text NOT NULL DEFAULT 'active',
  package_id uuid REFERENCES public.packages(id),
  router_id uuid REFERENCES public.routers(id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  router_id uuid REFERENCES public.routers(id) ON DELETE SET NULL,
  mac_address text,
  ip_address text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  bytes_in bigint DEFAULT 0,
  bytes_out bigint DEFAULT 0,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  package_id uuid REFERENCES public.packages(id),
  phone text,
  amount numeric(10,2) NOT NULL,
  mpesa_receipt text UNIQUE,
  checkout_request_id text,
  status text NOT NULL DEFAULT 'pending', -- pending|success|failed
  raw_callback jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.captive_portals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  logo_url text,
  background_url text,
  primary_color text DEFAULT '#0ea5e9',
  welcome_text text,
  terms_text text,
  enable_voucher boolean DEFAULT true,
  enable_otp boolean DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id),
  subject text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ GRANTS ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.packages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.captive_portals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO authenticated;
GRANT ALL ON public.tenants, public.profiles, public.user_roles, public.routers, public.packages,
            public.customers, public.sessions, public.payments, public.captive_portals,
            public.support_tickets TO service_role;

-- ============ RLS ============
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.captive_portals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- user_roles
CREATE POLICY "roles self read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY "roles super admin write" ON public.user_roles FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
-- Allow new signups to claim tenant_admin on the tenant they just created
CREATE POLICY "roles self insert tenant_admin" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'tenant_admin');

-- tenants
CREATE POLICY "tenants member read" ON public.tenants FOR SELECT TO authenticated
  USING (id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));
CREATE POLICY "tenants signup insert" ON public.tenants FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tenants admin update" ON public.tenants FOR UPDATE TO authenticated
  USING (id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));
CREATE POLICY "tenants super delete" ON public.tenants FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

-- Generic tenant-scoped policy generator (applied per table)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['routers','packages','customers','sessions','payments','captive_portals','support_tickets']
  LOOP
    EXECUTE format($f$
      CREATE POLICY "%1$s tenant access" ON public.%1$I FOR ALL TO authenticated
        USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()))
        WITH CHECK (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));
    $f$, t);
  END LOOP;
END$$;
-- END MIGRATION: supabase/migrations/20260531141120_a368e0f5-5bf5-456d-9536-c884d0cde707.sql

-- BEGIN MIGRATION: supabase/migrations/20260602051101_d5826c0c-6a3d-4e4f-8995-fd026949ee90.sql
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
-- END MIGRATION: supabase/migrations/20260602051101_d5826c0c-6a3d-4e4f-8995-fd026949ee90.sql

-- BEGIN MIGRATION: supabase/migrations/20260603042955_7dc3ca0b-6b91-454b-8f93-31f5c43e8aba.sql

-- 1. Drop permissive policies
DROP POLICY IF EXISTS "tenants signup insert" ON public.tenants;
DROP POLICY IF EXISTS "roles self insert tenant_admin" ON public.user_roles;

-- 2. Secure bootstrap function: create tenant + assign caller as tenant_admin atomically
CREATE OR REPLACE FUNCTION public.bootstrap_tenant(p_name text, p_slug text, p_full_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_tenant_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 OR length(p_name) > 200 THEN
    RAISE EXCEPTION 'Invalid tenant name';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9-]{3,60}$' THEN
    RAISE EXCEPTION 'Invalid tenant slug';
  END IF;

  SELECT tenant_id INTO v_existing FROM public.profiles WHERE id = v_uid;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'User already belongs to a tenant';
  END IF;

  -- Also block if caller already has any role row
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'User already has a role assigned';
  END IF;

  INSERT INTO public.tenants (name, slug)
  VALUES (btrim(p_name), p_slug)
  RETURNING id INTO v_tenant_id;

  UPDATE public.profiles
  SET tenant_id = v_tenant_id,
      full_name = COALESCE(NULLIF(btrim(p_full_name), ''), full_name)
  WHERE id = v_uid;

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (v_uid, 'tenant_admin', v_tenant_id);

  RETURN v_tenant_id;
END;
$$;

-- 3. Lock down EXECUTE on SECURITY DEFINER helpers (no anon / public)
REVOKE ALL ON FUNCTION public.bootstrap_tenant(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_tenant(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.user_tenant_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_tenant_id(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
-- END MIGRATION: supabase/migrations/20260603042955_7dc3ca0b-6b91-454b-8f93-31f5c43e8aba.sql

-- BEGIN MIGRATION: supabase/migrations/20260603050402_bacd605a-0a6b-42a7-bd98-abcd60ff9f18.sql
-- Super-admin approval RPC for new signups
CREATE OR REPLACE FUNCTION public.admin_approve_user(
  p_user_id uuid,
  p_role public.app_role,
  p_tenant_id uuid DEFAULT NULL,
  p_new_tenant_name text DEFAULT NULL,
  p_new_tenant_slug text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_tenant uuid := p_tenant_id;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_super_admin(v_caller) THEN
    RAISE EXCEPTION 'Only super admins can approve users';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  IF p_role = 'super_admin' THEN
    v_tenant := NULL;
  ELSE
    IF v_tenant IS NULL THEN
      -- Create a new tenant if name+slug provided
      IF p_new_tenant_name IS NULL OR length(btrim(p_new_tenant_name)) = 0 THEN
        RAISE EXCEPTION 'Tenant required for non super-admin roles';
      END IF;
      IF p_new_tenant_slug IS NULL OR p_new_tenant_slug !~ '^[a-z0-9-]{3,60}$' THEN
        RAISE EXCEPTION 'Invalid tenant slug';
      END IF;
      INSERT INTO public.tenants (name, slug)
      VALUES (btrim(p_new_tenant_name), p_new_tenant_slug)
      RETURNING id INTO v_tenant;
    END IF;
  END IF;

  -- Attach tenant to profile (clears for super_admin)
  UPDATE public.profiles SET tenant_id = v_tenant WHERE id = p_user_id;

  -- Insert role (idempotent on unique user_id+role)
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (p_user_id, p_role, v_tenant)
  ON CONFLICT (user_id, role) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

  RETURN COALESCE(v_tenant, p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_user(uuid, public.app_role, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_user(uuid, public.app_role, uuid, text, text) TO authenticated;

-- Allow super admins to read all profiles (already covered by existing policy via is_super_admin),
-- and ensure they can read user_roles for all users (existing policy covers this too).
-- END MIGRATION: supabase/migrations/20260603050402_bacd605a-0a6b-42a7-bd98-abcd60ff9f18.sql

-- BEGIN MIGRATION: supabase/migrations/20260604053435_965a9e9c-5ba1-407e-94a1-e01b46a6e118.sql
CREATE OR REPLACE FUNCTION public.admin_approve_user(
  p_user_id uuid,
  p_role public.app_role,
  p_tenant_id uuid DEFAULT NULL,
  p_new_tenant_name text DEFAULT NULL,
  p_new_tenant_slug text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_tenant uuid := p_tenant_id;
  v_profile_exists boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_super_admin(v_caller) THEN
    RAISE EXCEPTION 'Only super admins can approve users';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id
  ) INTO v_profile_exists;

  IF NOT v_profile_exists THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF p_role = 'super_admin' THEN
    v_tenant := NULL;
  ELSE
    IF v_tenant IS NULL THEN
      IF p_new_tenant_name IS NULL OR length(btrim(p_new_tenant_name)) = 0 THEN
        RAISE EXCEPTION 'Tenant required for non super-admin roles';
      END IF;

      IF p_new_tenant_slug IS NULL OR p_new_tenant_slug !~ '^[a-z0-9-]{3,60}$' THEN
        RAISE EXCEPTION 'Invalid tenant slug';
      END IF;

      INSERT INTO public.tenants (name, slug)
      VALUES (btrim(p_new_tenant_name), p_new_tenant_slug)
      RETURNING id INTO v_tenant;
    END IF;
  END IF;

  UPDATE public.profiles
  SET tenant_id = v_tenant
  WHERE id = p_user_id;

  DELETE FROM public.user_roles
  WHERE user_id = p_user_id
    AND role = p_role
    AND tenant_id IS NOT DISTINCT FROM v_tenant;

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (p_user_id, p_role, v_tenant);

  RETURN COALESCE(v_tenant, p_user_id);
END;
$$;
-- END MIGRATION: supabase/migrations/20260604053435_965a9e9c-5ba1-407e-94a1-e01b46a6e118.sql

-- BEGIN MIGRATION: supabase/migrations/20260604053624_5f4dac56-1538-4d1b-9917-e1228b5879cb.sql
CREATE POLICY "tenants super insert" ON public.tenants FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));
-- END MIGRATION: supabase/migrations/20260604053624_5f4dac56-1538-4d1b-9917-e1228b5879cb.sql

-- BEGIN MIGRATION: supabase/migrations/20260605010055_e20d4fdd-e37e-49c0-b90d-db2591894001.sql

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
-- END MIGRATION: supabase/migrations/20260605010055_e20d4fdd-e37e-49c0-b90d-db2591894001.sql

-- BEGIN MIGRATION: supabase/migrations/20260606012419_291f4ebc-b15d-47b1-a9ab-e4b99ac447e3.sql

ALTER TABLE public.routers
  ADD COLUMN IF NOT EXISTS cpu_load integer,
  ADD COLUMN IF NOT EXISTS free_memory_mb integer,
  ADD COLUMN IF NOT EXISTS total_memory_mb integer,
  ADD COLUMN IF NOT EXISTS hdd_free_mb integer,
  ADD COLUMN IF NOT EXISTS temperature numeric,
  ADD COLUMN IF NOT EXISTS voltage numeric,
  ADD COLUMN IF NOT EXISTS board_name text,
  ADD COLUMN IF NOT EXISTS firmware_version text,
  ADD COLUMN IF NOT EXISTS architecture text,
  ADD COLUMN IF NOT EXISTS wan_ip text,
  ADD COLUMN IF NOT EXISTS lan_ip text,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

ALTER PUBLICATION supabase_realtime ADD TABLE public.routers;
ALTER TABLE public.routers REPLICA IDENTITY FULL;
-- END MIGRATION: supabase/migrations/20260606012419_291f4ebc-b15d-47b1-a9ab-e4b99ac447e3.sql

-- BEGIN MIGRATION: supabase/migrations/20261023000000_lock_profiles_columns.sql
-- SECURITY: authenticated users could UPDATE profiles.tenant_id on their own row
-- (policy had no WITH CHECK / column limit). Every tenant-scoped policy trusts
-- user_tenant_id(), so this allowed joining any tenant. Profiles are now created
-- by handle_new_user() and modified by SECURITY DEFINER functions only
-- (bootstrap_tenant, admin_approve_user); the only self-editable column is full_name.

DROP POLICY IF EXISTS "profiles self insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;

REVOKE INSERT, UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

CREATE POLICY "profiles self update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
-- END MIGRATION: supabase/migrations/20261023000000_lock_profiles_columns.sql

-- BEGIN MIGRATION: drizzle/migrations/0000_router_metrics_phase2.sql
CREATE TABLE public.router_metrics (
  id bigserial PRIMARY KEY,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  cpu_pct integer,
  mem_pct integer,
  rx_bps bigint,
  tx_bps bigint,
  wan_latency_ms numeric,
  wan_loss_pct numeric,
  temp numeric
);
CREATE INDEX router_metrics_router_ts ON public.router_metrics (router_id, ts DESC);
GRANT SELECT ON public.router_metrics TO authenticated;
GRANT ALL ON public.router_metrics TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.router_metrics_id_seq TO service_role;
ALTER TABLE public.router_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "router_metrics tenant read" ON public.router_metrics FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE TABLE public.router_metrics_daily (
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  day date NOT NULL,
  avg_cpu numeric, max_cpu integer, avg_mem numeric, max_mem integer,
  avg_temp numeric, samples integer NOT NULL DEFAULT 0,
  PRIMARY KEY (router_id, day)
);
GRANT SELECT ON public.router_metrics_daily TO authenticated;
GRANT ALL ON public.router_metrics_daily TO service_role;
ALTER TABLE public.router_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "router_metrics_daily tenant read" ON public.router_metrics_daily FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE TABLE public.router_uptime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'down',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX router_uptime_events_router ON public.router_uptime_events (router_id, started_at DESC);
GRANT SELECT ON public.router_uptime_events TO authenticated;
GRANT ALL ON public.router_uptime_events TO service_role;
ALTER TABLE public.router_uptime_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "router_uptime_events tenant read" ON public.router_uptime_events FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.rollup_router_metrics()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.router_metrics_daily (router_id, tenant_id, day, avg_cpu, max_cpu, avg_mem, max_mem, avg_temp, samples)
  SELECT router_id, tenant_id, ts::date, avg(cpu_pct), max(cpu_pct), avg(mem_pct), max(mem_pct), avg(temp), count(*)
  FROM public.router_metrics
  WHERE ts >= (now() - interval '2 days')::date AND ts < now()::date
  GROUP BY router_id, tenant_id, ts::date
  ON CONFLICT (router_id, day) DO UPDATE SET
    avg_cpu = EXCLUDED.avg_cpu, max_cpu = EXCLUDED.max_cpu, avg_mem = EXCLUDED.avg_mem,
    max_mem = EXCLUDED.max_mem, avg_temp = EXCLUDED.avg_temp, samples = EXCLUDED.samples;
  DELETE FROM public.router_metrics WHERE ts < now() - interval '30 days';
  DELETE FROM public.router_metrics_daily WHERE day < (now() - interval '24 months')::date;
END $$;
REVOKE EXECUTE ON FUNCTION public.rollup_router_metrics() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('rollup-router-metrics', '15 0 * * *', 'SELECT public.rollup_router_metrics()');
-- END MIGRATION: drizzle/migrations/0000_router_metrics_phase2.sql

-- BEGIN MIGRATION: drizzle/migrations/0001_phase3_interfaces_wan.sql
CREATE TABLE public.router_interfaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  running boolean NOT NULL DEFAULT false,
  disabled boolean NOT NULL DEFAULT false,
  rx_bytes bigint NOT NULL DEFAULT 0,
  tx_bytes bigint NOT NULL DEFAULT 0,
  rx_bps bigint NOT NULL DEFAULT 0,
  tx_bps bigint NOT NULL DEFAULT 0,
  rx_errors bigint NOT NULL DEFAULT 0,
  tx_errors bigint NOT NULL DEFAULT 0,
  rx_drops bigint NOT NULL DEFAULT 0,
  tx_drops bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (router_id, name)
);
GRANT SELECT ON public.router_interfaces TO authenticated;
GRANT ALL ON public.router_interfaces TO service_role;
ALTER TABLE public.router_interfaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "router_interfaces tenant read" ON public.router_interfaces FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

ALTER TABLE public.router_metrics ADD COLUMN IF NOT EXISTS dns_ok boolean;
ALTER TABLE public.router_metrics ADD COLUMN IF NOT EXISTS wan_jitter_ms numeric;

ALTER PUBLICATION supabase_realtime ADD TABLE public.router_interfaces;
-- END MIGRATION: drizzle/migrations/0001_phase3_interfaces_wan.sql

-- BEGIN MIGRATION: drizzle/migrations/0002_customers_router_set_null.sql
ALTER TABLE public.customers DROP CONSTRAINT customers_router_id_fkey;
ALTER TABLE public.customers ADD CONSTRAINT customers_router_id_fkey FOREIGN KEY (router_id) REFERENCES public.routers(id) ON DELETE SET NULL;
-- END MIGRATION: drizzle/migrations/0002_customers_router_set_null.sql

-- BEGIN MIGRATION: drizzle/migrations/0003_bind_portal_assets_uploads_to_tenant.sql
-- Replace the unscoped upload rule on portal-assets with one tied to the
-- uploader's own tenant folder: the first path segment must be the tenant_id
-- from the caller's profile, so no signed-in user can upload into another
-- tenant's assets or outside the bucket.
DROP POLICY IF EXISTS "Authenticated users can upload portal assets" ON storage.objects;

CREATE POLICY "Authenticated users can upload portal assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'portal-assets'
  AND (storage.foldername(name))[1] = (
    SELECT p.tenant_id::text
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
  )
);
-- END MIGRATION: drizzle/migrations/0003_bind_portal_assets_uploads_to_tenant.sql

-- BEGIN MIGRATION: drizzle/migrations/0004_bind_portal_assets_owner.sql
-- Portal-assets uploads must be bound to their owner AND to the caller's tenant:
-- Storage sets owner_id from the uploader's session, and the first path folder must be the
-- caller's tenant_id, so tenants cannot write into each other's portal folders.
DROP POLICY IF EXISTS "Authenticated users can upload portal assets" ON storage.objects;
CREATE POLICY "Authenticated users can upload portal assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'portal-assets'
    AND owner_id = (SELECT auth.uid()::text)
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text
      FROM public.profiles p
      WHERE p.id = auth.uid()
    )
  );
-- END MIGRATION: drizzle/migrations/0004_bind_portal_assets_owner.sql

-- BEGIN MIGRATION: drizzle/migrations/0004_remove_login_throttle.sql
-- Removes the temporary sign-in lockout that blocked an account after five
-- wrong passwords. Failed attempts are still recorded (server-side only) so
-- repeated-failure and new-location security alerts keep working.
DROP FUNCTION IF EXISTS public.check_auth_login_throttle(text, text) CASCADE;
-- END MIGRATION: drizzle/migrations/0004_remove_login_throttle.sql

-- BEGIN MIGRATION: supabase/migrations/20261024000000_role_based_access.sql
-- Role-based access INSIDE a tenant.
--
-- Until now every policy only checked "same tenant", so a technician or billing agent
-- could read and change everything the tenant admin could (payments, bank details,
-- router tokens, the platform commission rate...). Access is now decided by the
-- user's role rows in public.user_roles, which only super admins and the platform's
-- server functions can write.
--
--   tenant_admin   everything in their tenant
--   technician     routers (+ their metrics), customers, sessions, packages (read), support tickets
--   billing_agent  customers, vouchers, payments (read), packages (read), settlements (read)
--   support_staff  customers (read), sessions (read), packages (read), support tickets
--
-- Super admins keep full access everywhere.

-- 1. Older approvals may have a role row without a tenant; give them their profile's tenant
--    so they don't lose access below.
UPDATE public.user_roles ur
SET tenant_id = p.tenant_id
FROM public.profiles p
WHERE ur.user_id = p.id
  AND ur.tenant_id IS NULL
  AND ur.role <> 'super_admin'
  AND p.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles x
    WHERE x.user_id = ur.user_id AND x.role = ur.role AND x.tenant_id = p.tenant_id
  );

-- 2. Tenants where the caller holds any of the given roles. Evaluated once per query
--    (policies call it inside a sub-select), not once per row.
CREATE OR REPLACE FUNCTION public.tenants_with_role(_roles public.app_role[])
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT tenant_id
  FROM public.user_roles
  WHERE user_id = auth.uid() AND tenant_id IS NOT NULL AND role = ANY (_roles);
$$;
REVOKE ALL ON FUNCTION public.tenants_with_role(public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenants_with_role(public.app_role[]) TO authenticated;

-- 3. Per-table, per-command policies. tenant_admin is always included.
--    write_extra NULL  => table is read-only for tenants (written by the platform only)
--    write_extra {}    => only tenant_admin may write
DO $$
DECLARE
  spec record;
  r_read text;
  r_write text;
  cond_read text;
  cond_write text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('routers',              ARRAY['technician'],                              ARRAY['technician']),
      ('packages',             ARRAY['technician','billing_agent','support_staff'], ARRAY[]::text[]),
      ('customers',            ARRAY['technician','billing_agent','support_staff'], ARRAY['technician','billing_agent']),
      ('sessions',             ARRAY['technician','support_staff'],              ARRAY[]::text[]),
      ('payments',             ARRAY['billing_agent'],                           ARRAY[]::text[]),
      ('captive_portals',      ARRAY[]::text[],                                  ARRAY[]::text[]),
      ('support_tickets',      ARRAY['technician','support_staff'],              ARRAY['technician','support_staff']),
      ('vouchers',             ARRAY['billing_agent'],                           ARRAY['billing_agent']),
      ('router_metrics',       ARRAY['technician'],                              NULL::text[]),
      ('router_metrics_daily', ARRAY['technician'],                              NULL::text[]),
      ('router_uptime_events', ARRAY['technician'],                              NULL::text[]),
      ('router_interfaces',    ARRAY['technician'],                              NULL::text[]),
      ('settlements',          ARRAY['billing_agent'],                           NULL::text[])
    ) AS v(tbl, read_extra, write_extra)
  LOOP
    SELECT string_agg(quote_literal(x), ',') INTO r_read
      FROM unnest(ARRAY['tenant_admin'] || spec.read_extra) x;
    cond_read := format(
      '(SELECT public.is_super_admin(auth.uid())) OR tenant_id IN (SELECT public.tenants_with_role(ARRAY[%s]::public.app_role[]))',
      r_read);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || ' tenant access', spec.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || ' tenant read', spec.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || ' role read', spec.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || ' role insert', spec.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || ' role update', spec.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || ' role delete', spec.tbl);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
      spec.tbl || ' role read', spec.tbl, cond_read);

    IF spec.write_extra IS NOT NULL THEN
      SELECT string_agg(quote_literal(x), ',') INTO r_write
        FROM unnest(ARRAY['tenant_admin'] || spec.write_extra) x;
      cond_write := format(
        '(SELECT public.is_super_admin(auth.uid())) OR tenant_id IN (SELECT public.tenants_with_role(ARRAY[%s]::public.app_role[]))',
        r_write);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
        spec.tbl || ' role insert', spec.tbl, cond_write);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
        spec.tbl || ' role update', spec.tbl, cond_write, cond_write);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
        spec.tbl || ' role delete', spec.tbl, cond_write);
    END IF;
  END LOOP;
END$$;

-- 4. The tenant row itself (bank details, M-Pesa settings, commission rate) is for admins only.
DROP POLICY IF EXISTS "tenants member read" ON public.tenants;
DROP POLICY IF EXISTS "tenants admin update" ON public.tenants;

DROP POLICY IF EXISTS "tenants admin read" ON public.tenants;
CREATE POLICY "tenants admin read" ON public.tenants FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin(auth.uid()))
    OR id IN (SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[]))
  );

CREATE POLICY "tenants admin update" ON public.tenants FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin(auth.uid()))
    OR id IN (SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[]))
  )
  WITH CHECK (
    (SELECT public.is_super_admin(auth.uid()))
    OR id IN (SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[]))
  );

-- 5. Even tenant admins must not change platform-controlled fields on their own tenant
--    (commission rate, suspension status, slug/subdomain, legacy Daraja credentials).
--    Server-side code (service role, no JWT user) and super admins are unaffected.
CREATE OR REPLACE FUNCTION public.protect_tenant_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.slug IS DISTINCT FROM OLD.slug
       OR NEW.subdomain IS DISTINCT FROM OLD.subdomain
       OR NEW.platform_commission_pct IS DISTINCT FROM OLD.platform_commission_pct
       OR NEW.mpesa_shortcode IS DISTINCT FROM OLD.mpesa_shortcode
       OR NEW.mpesa_consumer_key IS DISTINCT FROM OLD.mpesa_consumer_key
       OR NEW.mpesa_consumer_secret IS DISTINCT FROM OLD.mpesa_consumer_secret
       OR NEW.mpesa_passkey IS DISTINCT FROM OLD.mpesa_passkey
       OR NEW.mpesa_env IS DISTINCT FROM OLD.mpesa_env
    THEN
      RAISE EXCEPTION 'Only platform admins can change this field' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_tenant_columns ON public.tenants;
CREATE TRIGGER protect_tenant_columns
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.protect_tenant_columns();
-- END MIGRATION: supabase/migrations/20261024000000_role_based_access.sql

-- BEGIN MIGRATION: supabase/migrations/20261024120000_router_liveness_check.sql
-- Router liveness sweeper.
--
-- Routers push a heartbeat every minute (the platform cannot ping them: they sit behind
-- NAT on customer connections). Nothing used to mark a router offline when the
-- heartbeats stopped, so routers.status stayed 'online' forever and an outage was only
-- recorded after the router came back.
--
-- Every 5 minutes this job looks for routers whose last heartbeat is older than 5 minutes
-- (i.e. several consecutive missed heartbeats, so a single dropped request never
-- triggers it), flips them to 'offline' and opens a downtime event dated from the last
-- heartbeat. The heartbeat endpoint closes the event when the router reports in again.
-- Requires the router_uptime_events table (drizzle/migrations/0000_router_metrics_phase2.sql).

CREATE OR REPLACE FUNCTION public.check_router_liveness(p_stale interval DEFAULT interval '5 minutes')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    UPDATE public.routers r
       SET status = 'offline'
     WHERE r.status = 'online'
       AND COALESCE(r.last_heartbeat_at, r.last_seen_at, r.created_at) < now() - p_stale
    RETURNING r.id, r.tenant_id,
              COALESCE(r.last_heartbeat_at, r.last_seen_at, r.created_at) AS went_silent
  ), opened AS (
    INSERT INTO public.router_uptime_events (router_id, tenant_id, kind, started_at)
    SELECT s.id, s.tenant_id, 'down', s.went_silent
      FROM stale s
     WHERE NOT EXISTS (
       SELECT 1 FROM public.router_uptime_events e
        WHERE e.router_id = s.id AND e.kind = 'down' AND e.ended_at IS NULL
     )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM stale;
  RETURN v_count;
END
$$;

REVOKE EXECUTE ON FUNCTION public.check_router_liveness(interval) FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Scheduling with an existing job name replaces that job, so this is safe to re-run.
SELECT cron.schedule('router-liveness-check', '*/5 * * * *', 'SELECT public.check_router_liveness()');
-- END MIGRATION: supabase/migrations/20261024120000_router_liveness_check.sql

-- BEGIN MIGRATION: supabase/migrations/20261024130000_pppoe_unique_username.sql
-- PPPoE usernames must be unique within a tenant (case-insensitive): the router sync emits one
-- /ppp secret per customer, and two clients sharing a username would overwrite each other.
-- NOTE: if this fails, the tenant already has duplicate PPPoE usernames; rename them first with
--   SELECT tenant_id, lower(pppoe_username), count(*) FROM public.customers
--    WHERE pppoe_username IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_pppoe_username_key
  ON public.customers (tenant_id, lower(pppoe_username))
  WHERE pppoe_username IS NOT NULL;
-- END MIGRATION: supabase/migrations/20261024130000_pppoe_unique_username.sql

-- BEGIN MIGRATION: supabase/migrations/20261024140000_tv_devices.sql
-- Smart-TV access. TVs cannot open a captive-portal page, so the customer registers the TV's
-- MAC address from their phone, pays for a plan, and the router then lets that MAC through the
-- hotspot (ip-binding type=bypassed) until the plan expires. The router sync script
-- (/api/public/router/sync/<token>) emits one binding per active, unexpired device.
--
-- Writes happen only through server code (service role): the public portal endpoint registers
-- devices and the payment callback activates them. Tenant staff can read their own devices.

CREATE TABLE IF NOT EXISTS public.tv_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  mac_address text NOT NULL CHECK (mac_address ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  name        text,
  phone       text,
  package_id  uuid REFERENCES public.packages(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'active', 'expired', 'blocked')),
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mac_address)
);

CREATE INDEX IF NOT EXISTS tv_devices_tenant_status_idx ON public.tv_devices (tenant_id, status);

ALTER TABLE public.tv_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tv_devices tenant read" ON public.tv_devices;
CREATE POLICY "tv_devices tenant read" ON public.tv_devices
  FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

GRANT SELECT ON public.tv_devices TO authenticated;
GRANT ALL ON public.tv_devices TO service_role;

-- Lets the payment callback know a payment is for a TV (activate the device instead of minting a voucher).
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS tv_device_id uuid REFERENCES public.tv_devices(id) ON DELETE SET NULL;
-- END MIGRATION: supabase/migrations/20261024140000_tv_devices.sql

-- BEGIN MIGRATION: supabase/migrations/20261024150000_portal_theme.sql
-- Captive-portal theme chosen by the ISP. The list of themes lives in application code
-- (src/lib/portal-themes.ts); unknown values fall back to 'classic', so adding a theme later
-- needs no migration. Existing portals keep the look they had ('classic').
ALTER TABLE public.captive_portals
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'classic'
  CHECK (theme ~ '^[a-z0-9_-]{1,32}$');
-- END MIGRATION: supabase/migrations/20261024150000_portal_theme.sql

-- BEGIN MIGRATION: supabase/migrations/20261025000000_role_aware_rls_and_mfa.sql
-- Role-aware row security + server-enforced two-step verification (MFA).
--
-- PROBLEM 1 - MFA was only a browser redirect. requireConsole() sends users to /mfa, but no
--   policy or server function looked at the session's assurance level, so a password-only
--   session could call the Supabase API directly and skip the one-time code.
-- PROBLEM 2 - Every tenant policy was "any member of the tenant may do anything": a support_staff
--   or technician could, straight through the API, forge payments, mint vouchers, delete routers,
--   or rewrite the tenant's payout details and platform_commission_pct.
--
-- FIX 1: RESTRICTIVE policies require an aal2 JWT on every business table (and on writes to
--   user_roles). profiles / user_roles stay readable at aal1 because sign-in, the /mfa page and
--   the "pending approval" page need them before the code is entered.
-- FIX 2: per-command policies keyed on the caller's user_roles row for that tenant.
--
--   table             SELECT                 INSERT               UPDATE        DELETE
--   routers           staff                  admin, technician    same          same
--   packages          any role               admin, billing       same          same
--   customers         staff                  admin, billing, support  same      admin, billing
--   vouchers          staff                  admin, billing, support  admin, billing  admin, billing
--   payments          admin, billing, support  (server only)       -             -
--   sessions          staff                  (server only)        -             -
--   captive_portals   staff                  admin                same          same
--   support_tickets   staff                  staff                staff         admin
--   settlements       admin, billing         (super admin only)   -             -
--   tenants           (unchanged)            (super admin only)   admin, limited columns   (super admin only)
--   staff = tenant_admin, technician, billing_agent, support_staff. super_admin may do everything.
--   Payments/sessions are written by the server (service role), never by the browser.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_tenant_role(_user_id uuid, _tenant_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = _user_id AND ur.tenant_id = _tenant_id AND ur.role = ANY (_roles)
  )
$$;
REVOKE ALL ON FUNCTION public.has_tenant_role(uuid, uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_tenant_role(uuid, uuid, public.app_role[]) TO authenticated;

-- True only when the access token was issued after a successful MFA challenge.
CREATE OR REPLACE FUNCTION public.is_aal2()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
REVOKE ALL ON FUNCTION public.is_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_aal2() TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- FIX 1: require aal2
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','routers','packages','customers','sessions','payments','captive_portals',
    'support_tickets','vouchers','settlements','platform_mpesa_config',
    'router_metrics','router_metrics_daily','router_uptime_events','router_interfaces'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s require aal2" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s require aal2" ON public.%1$I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (public.is_aal2()) WITH CHECK (public.is_aal2())', t);
  END LOOP;
END $$;

-- Role changes need aal2 too (reads stay open at aal1 for sign-in routing).
DROP POLICY IF EXISTS "user_roles insert require aal2" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles update require aal2" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles delete require aal2" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles insert require aal2" ON public.user_roles;
CREATE POLICY "user_roles insert require aal2" ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.is_aal2());
DROP POLICY IF EXISTS "user_roles update require aal2" ON public.user_roles;
CREATE POLICY "user_roles update require aal2" ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.is_aal2()) WITH CHECK (public.is_aal2());
DROP POLICY IF EXISTS "user_roles delete require aal2" ON public.user_roles;
CREATE POLICY "user_roles delete require aal2" ON public.user_roles AS RESTRICTIVE FOR DELETE TO authenticated USING (public.is_aal2());

-- ---------------------------------------------------------------------------------------------
-- FIX 2: role-aware policies (replace the "any member can do anything" ones)
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "routers tenant access" ON public.routers;
DROP POLICY IF EXISTS "packages tenant access" ON public.packages;
DROP POLICY IF EXISTS "customers tenant access" ON public.customers;
DROP POLICY IF EXISTS "sessions tenant access" ON public.sessions;
DROP POLICY IF EXISTS "payments tenant access" ON public.payments;
DROP POLICY IF EXISTS "captive_portals tenant access" ON public.captive_portals;
DROP POLICY IF EXISTS "support_tickets tenant access" ON public.support_tickets;
DROP POLICY IF EXISTS "vouchers tenant access" ON public.vouchers;
DROP POLICY IF EXISTS "settlements tenant read" ON public.settlements;

-- routers
DROP POLICY IF EXISTS "routers select by role" ON public.routers;
CREATE POLICY "routers select by role" ON public.routers
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
DROP POLICY IF EXISTS "routers insert by role" ON public.routers;
CREATE POLICY "routers insert by role" ON public.routers
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician']::public.app_role[]));
DROP POLICY IF EXISTS "routers update by role" ON public.routers;
CREATE POLICY "routers update by role" ON public.routers
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician']::public.app_role[]));
DROP POLICY IF EXISTS "routers delete by role" ON public.routers;
CREATE POLICY "routers delete by role" ON public.routers
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician']::public.app_role[]));

-- packages
DROP POLICY IF EXISTS "packages select by role" ON public.packages;
CREATE POLICY "packages select by role" ON public.packages
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff','end_user']::public.app_role[]));
DROP POLICY IF EXISTS "packages insert by role" ON public.packages;
CREATE POLICY "packages insert by role" ON public.packages
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));
DROP POLICY IF EXISTS "packages update by role" ON public.packages;
CREATE POLICY "packages update by role" ON public.packages
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));
DROP POLICY IF EXISTS "packages delete by role" ON public.packages;
CREATE POLICY "packages delete by role" ON public.packages
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));

-- customers
DROP POLICY IF EXISTS "customers select by role" ON public.customers;
CREATE POLICY "customers select by role" ON public.customers
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
DROP POLICY IF EXISTS "customers insert by role" ON public.customers;
CREATE POLICY "customers insert by role" ON public.customers
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent','support_staff']::public.app_role[]));
DROP POLICY IF EXISTS "customers update by role" ON public.customers;
CREATE POLICY "customers update by role" ON public.customers
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent','support_staff']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent','support_staff']::public.app_role[]));
DROP POLICY IF EXISTS "customers delete by role" ON public.customers;
CREATE POLICY "customers delete by role" ON public.customers
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));

-- vouchers
DROP POLICY IF EXISTS "vouchers select by role" ON public.vouchers;
CREATE POLICY "vouchers select by role" ON public.vouchers
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
DROP POLICY IF EXISTS "vouchers insert by role" ON public.vouchers;
CREATE POLICY "vouchers insert by role" ON public.vouchers
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent','support_staff']::public.app_role[]));
DROP POLICY IF EXISTS "vouchers update by role" ON public.vouchers;
CREATE POLICY "vouchers update by role" ON public.vouchers
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));
DROP POLICY IF EXISTS "vouchers delete by role" ON public.vouchers;
CREATE POLICY "vouchers delete by role" ON public.vouchers
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));

-- payments
DROP POLICY IF EXISTS "payments select by role" ON public.payments;
CREATE POLICY "payments select by role" ON public.payments
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent','support_staff']::public.app_role[]));

-- sessions
DROP POLICY IF EXISTS "sessions select by role" ON public.sessions;
CREATE POLICY "sessions select by role" ON public.sessions
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));

-- captive_portals
DROP POLICY IF EXISTS "captive_portals select by role" ON public.captive_portals;
CREATE POLICY "captive_portals select by role" ON public.captive_portals
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
DROP POLICY IF EXISTS "captive_portals insert by role" ON public.captive_portals;
CREATE POLICY "captive_portals insert by role" ON public.captive_portals
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]));
DROP POLICY IF EXISTS "captive_portals update by role" ON public.captive_portals;
CREATE POLICY "captive_portals update by role" ON public.captive_portals
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]));
DROP POLICY IF EXISTS "captive_portals delete by role" ON public.captive_portals;
CREATE POLICY "captive_portals delete by role" ON public.captive_portals
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]));

-- support_tickets
DROP POLICY IF EXISTS "support_tickets select by role" ON public.support_tickets;
CREATE POLICY "support_tickets select by role" ON public.support_tickets
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
DROP POLICY IF EXISTS "support_tickets insert by role" ON public.support_tickets;
CREATE POLICY "support_tickets insert by role" ON public.support_tickets
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
DROP POLICY IF EXISTS "support_tickets update by role" ON public.support_tickets;
CREATE POLICY "support_tickets update by role" ON public.support_tickets
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
DROP POLICY IF EXISTS "support_tickets delete by role" ON public.support_tickets;
CREATE POLICY "support_tickets delete by role" ON public.support_tickets
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]));

-- settlements
DROP POLICY IF EXISTS "settlements select by role" ON public.settlements;
CREATE POLICY "settlements select by role" ON public.settlements
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));

-- tenants: only a tenant_admin may edit the tenant, and only the columns the Settings page
-- uses. status, slug, subdomain, platform_commission_pct and the platform's own M-Pesa
-- fields are not editable from the browser (a member could previously set the commission to 0).
DROP POLICY IF EXISTS "tenants admin update" ON public.tenants;
DROP POLICY IF EXISTS "tenants update by role" ON public.tenants;
CREATE POLICY "tenants update by role" ON public.tenants
  FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), id, ARRAY['tenant_admin']::public.app_role[]))
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), id, ARRAY['tenant_admin']::public.app_role[]));

REVOKE UPDATE ON public.tenants FROM authenticated;
GRANT UPDATE (name, logo_url, primary_color, mpesa_paybill, mpesa_till, bank_name, bank_account_name,
              bank_account_number, bank_branch, payment_instructions, support_phone, support_email)
  ON public.tenants TO authenticated;

-- Writes that only the server should make: drop browser write access entirely.
REVOKE INSERT, UPDATE, DELETE ON public.payments, public.sessions FROM authenticated;

-- Approving users / granting roles is the most sensitive RPC: require aal2 inside it as well.
CREATE OR REPLACE FUNCTION public.admin_approve_user(p_user_id uuid, p_role public.app_role, p_tenant_id uuid DEFAULT NULL::uuid, p_new_tenant_name text DEFAULT NULL::text, p_new_tenant_slug text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_tenant uuid := p_tenant_id;
  v_profile_exists boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_aal2() THEN
    RAISE EXCEPTION 'Two-step verification required';
  END IF;

  IF NOT public.is_super_admin(v_caller) THEN
    RAISE EXCEPTION 'Only super admins can approve users';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id
  ) INTO v_profile_exists;

  IF NOT v_profile_exists THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF p_role = 'super_admin' THEN
    v_tenant := NULL;
  ELSE
    IF v_tenant IS NULL THEN
      IF p_new_tenant_name IS NULL OR length(btrim(p_new_tenant_name)) = 0 THEN
        RAISE EXCEPTION 'Tenant required for non super-admin roles';
      END IF;

      IF p_new_tenant_slug IS NULL OR p_new_tenant_slug !~ '^[a-z0-9-]{3,60}$' THEN
        RAISE EXCEPTION 'Invalid tenant slug';
      END IF;

      INSERT INTO public.tenants (name, slug)
      VALUES (btrim(p_new_tenant_name), p_new_tenant_slug)
      RETURNING id INTO v_tenant;
    END IF;
  END IF;

  UPDATE public.profiles
  SET tenant_id = v_tenant
  WHERE id = p_user_id;

  DELETE FROM public.user_roles
  WHERE user_id = p_user_id
    AND role = p_role
    AND tenant_id IS NOT DISTINCT FROM v_tenant;

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (p_user_id, p_role, v_tenant);

  RETURN COALESCE(v_tenant, p_user_id);
END;
$function$;
-- END MIGRATION: supabase/migrations/20261025000000_role_aware_rls_and_mfa.sql

-- BEGIN MIGRATION: supabase/migrations/20261025010000_router_credentials.sql
-- Router credentials: separate the short-lived bootstrap token from the long-lived device token.
--
-- Before: routers.provision_token was BOTH the one-line command pasted into a terminal AND the
-- credential baked into the router's scheduler (heartbeat / sync / interfaces / login page URLs).
-- It was generated in the browser, never expired (provision_token_expires_at was set to +24h by the
-- UI but never checked), was readable by every tenant member, and could not be rotated.
--
-- Now
--   provision_token ...... bootstrap token, valid for 24h, only able to fetch router.rsc.
--   router_credentials ... the device token (stored as a SHA-256 hash). The server mints it when the
--                          router fetches router.rsc and embeds it in the scheduled URLs. Clients can
--                          never read it: the table has RLS on and no grants for anon / authenticated.
--   legacy_token_auth .... true for routers that already exist today, so their current scheduler URLs
--                          (which carry provision_token) keep working until they are re-provisioned.
--                          Re-provisioning (or revoking) turns it off for that router.

ALTER TABLE public.routers ADD COLUMN IF NOT EXISTS legacy_token_auth boolean NOT NULL DEFAULT false;
UPDATE public.routers SET legacy_token_auth = true WHERE provision_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.router_credentials (
  router_id  uuid PRIMARY KEY REFERENCES public.routers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.router_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.router_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.router_credentials TO service_role;

-- ---------- tokens can only be created / changed by the server ----------
-- Direct writes from the client roles are overridden (insert) or rejected (update). The SECURITY
-- DEFINER rotate function below runs as the table owner, so current_user is not 'authenticated'
-- there and it passes.
CREATE OR REPLACE FUNCTION public.guard_router_tokens()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.provision_token            := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    NEW.provision_token_expires_at := now() + interval '24 hours';
    NEW.legacy_token_auth          := false;
  ELSIF NEW.provision_token            IS DISTINCT FROM OLD.provision_token
     OR NEW.provision_token_expires_at IS DISTINCT FROM OLD.provision_token_expires_at
     OR NEW.legacy_token_auth          IS DISTINCT FROM OLD.legacy_token_auth THEN
    RAISE EXCEPTION 'Router tokens can only be changed with rotate_router_token()' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_router_tokens() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS guard_router_tokens ON public.routers;
CREATE TRIGGER guard_router_tokens BEFORE INSERT OR UPDATE ON public.routers
  FOR EACH ROW EXECUTE FUNCTION public.guard_router_tokens();

-- ---------- rotate / revoke ----------
-- Issues a new 24h bootstrap token and returns it. With p_revoke_device the router's current device
-- credential is also destroyed (and legacy auth turned off), so it stops authenticating at once:
-- use that when a token leaked. Without it the router keeps working until it is re-provisioned.
CREATE OR REPLACE FUNCTION public.rotate_router_token(p_router_id uuid, p_revoke_device boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_token  text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.routers WHERE id = p_router_id;
  IF v_tenant IS NULL
     OR NOT (public.is_super_admin(auth.uid())
             OR public.has_tenant_role(auth.uid(), v_tenant, ARRAY['tenant_admin','technician']::public.app_role[])) THEN
    RAISE EXCEPTION 'Router not found' USING ERRCODE = '42501';
  END IF;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  UPDATE public.routers
     SET provision_token = v_token,
         provision_token_expires_at = now() + interval '24 hours',
         legacy_token_auth = CASE WHEN p_revoke_device THEN false ELSE legacy_token_auth END
   WHERE id = p_router_id;

  IF p_revoke_device THEN
    DELETE FROM public.router_credentials WHERE router_id = p_router_id;
  END IF;
  RETURN v_token;
END $$;
REVOKE ALL ON FUNCTION public.rotate_router_token(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_router_token(uuid, boolean) TO authenticated;
-- END MIGRATION: supabase/migrations/20261025010000_router_credentials.sql

-- BEGIN MIGRATION: supabase/migrations/20261025020000_device_management.sql
-- Customer device management.
--
--  * vouchers.bound_mac   - the one device a voucher is pinned to (packages.device_limit = 1).
--                           The router sync script re-creates hotspot users every 2 minutes, so
--                           the binding lives here and is written back to the router each sync.
--  * routers.block_tethering - per-router switch for the anti-tethering rule (TTL trick). On by default.
--  * router_devices       - every device the routers report seeing on the hotspot (MAC, IP, name,
--                           which voucher/TV it belongs to, tethering suspicion, blocked flag).
--
-- Devices are written only by server code (the router's report endpoint and the block/unbind
-- server functions). Tenant staff may read their own tenant's devices.

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS bound_mac text
  CHECK (bound_mac IS NULL OR bound_mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$');

ALTER TABLE public.routers
  ADD COLUMN IF NOT EXISTS block_tethering boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.router_devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id        uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  mac              text NOT NULL CHECK (mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  ip               text,
  hostname         text,
  registered_kind  text CHECK (registered_kind IN ('voucher', 'tv')),
  voucher_code     text,
  authorized       boolean NOT NULL DEFAULT false,
  tether_suspected boolean NOT NULL DEFAULT false,
  blocked          boolean NOT NULL DEFAULT false,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (router_id, mac)
);

CREATE INDEX IF NOT EXISTS router_devices_tenant_seen_idx ON public.router_devices (tenant_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS router_devices_tenant_mac_idx ON public.router_devices (tenant_id, mac);
CREATE INDEX IF NOT EXISTS vouchers_bound_mac_idx ON public.vouchers (tenant_id, bound_mac) WHERE bound_mac IS NOT NULL;

ALTER TABLE public.router_devices ENABLE ROW LEVEL SECURITY;

-- Same rules as the other router tables: aal2 (MFA) session required, staff who work with
-- routers/customers can read. Nobody writes from the browser.
DROP POLICY IF EXISTS "router_devices require aal2" ON public.router_devices;
CREATE POLICY "router_devices require aal2" ON public.router_devices
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2()) WITH CHECK (public.is_aal2());

DROP POLICY IF EXISTS "router_devices staff read" ON public.router_devices;
CREATE POLICY "router_devices staff read" ON public.router_devices
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin(auth.uid()))
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','support_staff']::public.app_role[])
  );

GRANT SELECT ON public.router_devices TO authenticated;
GRANT ALL ON public.router_devices TO service_role;
-- END MIGRATION: supabase/migrations/20261025020000_device_management.sql

-- BEGIN MIGRATION: supabase/migrations/20261025030000_pppoe_router_and_sessions.sql
-- PPPoE clients: one credential belongs to ONE router, and the platform learns each client's MAC.
--
-- 1. Routers report their active PPPoE sessions (username, MAC = RouterOS "caller-id", IP) every
--    2 minutes. record_pppoe_sessions() stores the latest values on the customer row, so the PPPoE
--    page can show the client's MAC and whether they are connected right now.
-- 2. A PPPoE client must be assigned to a router of its own tenant. The form used to offer
--    "All routers", which put the same credential on every router.
--
-- Existing clients with no router keep working (the router sync still serves them to every router)
-- so nobody is cut off by this migration; the console flags them so they can be assigned.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS last_mac       text,
  ADD COLUMN IF NOT EXISTS last_ip        text,
  ADD COLUMN IF NOT EXISTS last_seen_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_router_id uuid REFERENCES public.routers(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.guard_pppoe_customer()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.customer_type = 'pppoe' THEN
    IF NEW.router_id IS NULL THEN
      -- Refuse new unassigned clients, and refuse un-assigning one. pg_trigger_depth() > 1 means the
      -- change comes from the foreign key itself (ON DELETE SET NULL when a router is deleted):
      -- that must keep working, so deleting a router never fails.
      IF pg_trigger_depth() = 1 AND (TG_OP = 'INSERT' OR OLD.router_id IS NOT NULL) THEN
        RAISE EXCEPTION 'A PPPoE client must be assigned to a router' USING ERRCODE = '23514';
      END IF;
    ELSIF TG_OP = 'INSERT' OR NEW.router_id IS DISTINCT FROM OLD.router_id THEN
      IF NOT EXISTS (SELECT 1 FROM public.routers r WHERE r.id = NEW.router_id AND r.tenant_id = NEW.tenant_id) THEN
        RAISE EXCEPTION 'Router not found' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- What the router reports about a client is written by the platform only, never by the browser.
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.last_mac := NULL; NEW.last_ip := NULL; NEW.last_seen_at := NULL; NEW.last_router_id := NULL;
    ELSIF NEW.last_mac       IS DISTINCT FROM OLD.last_mac
       OR NEW.last_ip        IS DISTINCT FROM OLD.last_ip
       OR NEW.last_seen_at   IS DISTINCT FROM OLD.last_seen_at
       OR NEW.last_router_id IS DISTINCT FROM OLD.last_router_id THEN
      RAISE EXCEPTION 'Device details are reported by the router and cannot be edited' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_pppoe_customer() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS guard_pppoe_customer ON public.customers;
CREATE TRIGGER guard_pppoe_customer BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_pppoe_customer();

-- Called by the router report endpoint (service role) with
--   p_sessions = [{"username": "...", "mac": "AA:BB:CC:DD:EE:FF", "ip": "10.10.0.5"}, ...]
-- Only clients of this tenant that belong to THIS router (or are still unassigned) are updated, so a
-- credential seen on a router it is not assigned to is ignored rather than recorded. Returns how many
-- clients were updated.
CREATE OR REPLACE FUNCTION public.record_pppoe_sessions(p_router_id uuid, p_tenant_id uuid, p_sessions jsonb)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT * FROM jsonb_to_recordset(p_sessions) AS x(username text, mac text, ip text) LIMIT 500
  ), u AS (
    UPDATE public.customers c
       SET last_mac = s.mac, last_ip = s.ip, last_seen_at = now(), last_router_id = p_router_id
      FROM s
     WHERE c.tenant_id = p_tenant_id
       AND c.customer_type = 'pppoe'
       AND c.pppoe_username = s.username
       AND (c.router_id IS NULL OR c.router_id = p_router_id)
    RETURNING 1
  )
  SELECT count(*)::int FROM u
$$;
REVOKE ALL ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) TO service_role;
-- END MIGRATION: supabase/migrations/20261025030000_pppoe_router_and_sessions.sql

-- BEGIN MIGRATION: supabase/migrations/20261025100000_inventory.sql
-- Inventory management: equipment catalogue + stock levels, serialized devices that can be
-- assigned to customers and monitored, and an append-only stock ledger.
--
--   inventory_items          what you stock: routers, ONTs, access points, switches, cables, other.
--                            `quantity` is the current stock level (pieces or metres). It can only
--                            change through stock_movements, so the ledger always explains the number.
--   stock_movements          append-only ledger: received, issued to a customer, returned, damaged, ...
--   inventory_devices        individual units (serial/MAC/IP). Can be assigned to a customer and, when
--                            an IP is set, monitored: a MikroTik router pings it and reports up/down.
--   inventory_device_events  up/down history written by the platform when a monitored device changes state.
--   inventory_alerts         outbox + history of alerts (device offline / back online / low stock) and whether
--                            the SMS went out. Written by the platform only.
--   alert_settings           per-tenant: who gets the SMS and which alerts they want (tenant admin only).
--
-- Access (same conventions as the rest of the schema: aal2 required, per-role policies):
--   read   tenant_admin, technician, support_staff
--   write  tenant_admin, technician       (stock_movements: insert only, never edited or deleted)
--   super_admin can do everything. device events are written by the server only.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category      text NOT NULL CHECK (category IN ('router','ont','access_point','switch','cable','other')),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  brand         text,
  model         text,
  unit          text NOT NULL DEFAULT 'pcs' CHECK (unit IN ('pcs','m')),
  quantity      numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level numeric NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  unit_cost     numeric CHECK (unit_cost IS NULL OR unit_cost >= 0),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_items_tenant_idx ON public.inventory_items (tenant_id, category);

CREATE TABLE IF NOT EXISTS public.inventory_devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id            uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  category           text NOT NULL CHECK (category IN ('router','ont','access_point','switch','other')),
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  brand              text,
  model              text,
  serial_number      text,
  mac_address        text CHECK (mac_address IS NULL OR mac_address ~* '^([0-9a-f]{2}:){5}[0-9a-f]{2}$'),
  ip_address         text CHECK (ip_address IS NULL OR ip_address ~ '^(25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(\.(25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}$'),
  status             text NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','deployed','faulty','retired')),
  customer_id        uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  location           text,
  notes              text,
  -- monitoring: a router on the same network pings ip_address and reports the result
  monitor_enabled    boolean NOT NULL DEFAULT false,
  monitor_router_id  uuid REFERENCES public.routers(id) ON DELETE SET NULL,
  online             boolean,
  loss_pct           smallint CHECK (loss_pct IS NULL OR loss_pct BETWEEN 0 AND 100),
  last_checked_at    timestamptz,
  last_seen_at       timestamptz,
  status_changed_at  timestamptz,
  latency_ms         integer CHECK (latency_ms IS NULL OR latency_ms BETWEEN 0 AND 60000),
  alerted_at         timestamptz,  -- set when an "offline" alert was raised for the current outage
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- equipment with a customer is out of stock; monitoring needs an address and a router to ping from
  CONSTRAINT inventory_devices_customer_not_in_stock CHECK (customer_id IS NULL OR status <> 'in_stock'),
  CONSTRAINT inventory_devices_monitor_needs_target CHECK (NOT monitor_enabled OR (ip_address IS NOT NULL AND monitor_router_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_devices_serial_uniq ON public.inventory_devices (tenant_id, lower(serial_number)) WHERE serial_number IS NOT NULL AND btrim(serial_number) <> '';
CREATE INDEX IF NOT EXISTS inventory_devices_tenant_idx   ON public.inventory_devices (tenant_id, category);
CREATE INDEX IF NOT EXISTS inventory_devices_customer_idx ON public.inventory_devices (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_devices_monitor_idx  ON public.inventory_devices (monitor_router_id) WHERE monitor_enabled;

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  change      numeric NOT NULL CHECK (change <> 0),
  reason      text NOT NULL CHECK (reason IN ('received','issued','returned','damaged','adjustment')),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  note        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_item_idx   ON public.stock_movements (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_tenant_idx ON public.stock_movements (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_device_events (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.inventory_devices(id) ON DELETE CASCADE,
  event     text NOT NULL CHECK (event IN ('up','down')),
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_device_events_idx ON public.inventory_device_events (device_id, at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_alerts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('device_down','device_up','low_stock')),
  device_id   uuid REFERENCES public.inventory_devices(id) ON DELETE SET NULL,
  item_id     uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sms_status  text NOT NULL DEFAULT 'pending' CHECK (sms_status IN ('pending','sending','sent','failed','skipped')),
  sms_sent_at timestamptz,
  sms_error   text
);
CREATE INDEX IF NOT EXISTS inventory_alerts_tenant_idx  ON public.inventory_alerts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_alerts_pending_idx ON public.inventory_alerts (tenant_id) WHERE sms_status = 'pending';

CREATE TABLE IF NOT EXISTS public.alert_settings (
  tenant_id           uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  sms_numbers         text[] NOT NULL DEFAULT '{}' CHECK (cardinality(sms_numbers) <= 5),
  notify_device_down  boolean NOT NULL DEFAULT true,
  notify_low_stock    boolean NOT NULL DEFAULT true,
  down_after_minutes  smallint NOT NULL DEFAULT 5 CHECK (down_after_minutes BETWEEN 1 AND 60),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Numbers are digits with an optional leading +, 9-15 long (e.g. 254712345678).
CREATE OR REPLACE FUNCTION public.alert_settings_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n text;
BEGIN
  FOREACH n IN ARRAY NEW.sms_numbers LOOP
    IF n !~ '^\+?[0-9]{9,15}$' THEN
      RAISE EXCEPTION 'Invalid phone number: %', n USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id cannot be changed' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS alert_settings_guard ON public.alert_settings;
CREATE TRIGGER alert_settings_guard BEFORE INSERT OR UPDATE ON public.alert_settings
  FOR EACH ROW EXECUTE FUNCTION public.alert_settings_guard();

-- ---------------------------------------------------------------------------------------------
-- Integrity triggers. RLS only checks the row's own tenant_id, so references to other tables
-- (item, customer, router, device) are verified here: nobody can point their row at another
-- tenant's data, and tenant_id can never be changed.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_items_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity <> 0 THEN
      RAISE EXCEPTION 'Add opening stock with a stock movement' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'tenant_id cannot be changed' USING ERRCODE = '42501';
    END IF;
    IF NEW.quantity IS DISTINCT FROM OLD.quantity AND COALESCE(current_setting('app.stock_move', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Stock levels change only through stock movements' USING ERRCODE = '42501';
    END IF;
    IF NEW.unit IS DISTINCT FROM OLD.unit AND OLD.quantity <> 0 THEN
      RAISE EXCEPTION 'Cannot change the unit of an item that has stock' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inventory_items_guard ON public.inventory_items;
CREATE TRIGGER inventory_items_guard BEFORE INSERT OR UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.inventory_items_guard();

CREATE OR REPLACE FUNCTION public.inventory_devices_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inventory_items WHERE id = NEW.item_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Unknown item' USING ERRCODE = '42501';
  END IF;
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Unknown customer' USING ERRCODE = '42501';
  END IF;
  IF NEW.monitor_router_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.routers WHERE id = NEW.monitor_router_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Unknown router' USING ERRCODE = '42501';
  END IF;
  -- Changing what is monitored invalidates the old reading.
  IF TG_OP = 'UPDATE' AND (NEW.ip_address IS DISTINCT FROM OLD.ip_address OR NEW.monitor_router_id IS DISTINCT FROM OLD.monitor_router_id OR NEW.monitor_enabled IS DISTINCT FROM OLD.monitor_enabled) THEN
    NEW.online := NULL; NEW.loss_pct := NULL; NEW.last_checked_at := NULL; NEW.last_seen_at := NULL; NEW.status_changed_at := NULL; NEW.latency_ms := NULL; NEW.alerted_at := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inventory_devices_guard ON public.inventory_devices;
CREATE TRIGGER inventory_devices_guard BEFORE INSERT OR UPDATE ON public.inventory_devices
  FOR EACH ROW EXECUTE FUNCTION public.inventory_devices_guard();

-- Applies a movement to the stock level atomically (row is locked, so two people issuing the last
-- unit at once cannot both succeed) and refuses to go below zero.
CREATE OR REPLACE FUNCTION public.stock_movements_apply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_new numeric;
BEGIN
  SELECT * INTO v_item FROM public.inventory_items
   WHERE id = NEW.item_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown item' USING ERRCODE = '42501';
  END IF;
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Unknown customer' USING ERRCODE = '42501';
  END IF;
  IF v_item.unit = 'pcs' AND NEW.change <> trunc(NEW.change) THEN
    RAISE EXCEPTION 'Pieces must be whole numbers' USING ERRCODE = '23514';
  END IF;
  -- sign must match the reason, so the history reads correctly
  IF (NEW.reason IN ('received','returned') AND NEW.change < 0)
     OR (NEW.reason IN ('issued','damaged') AND NEW.change > 0) THEN
    RAISE EXCEPTION 'Quantity direction does not match the reason' USING ERRCODE = '23514';
  END IF;
  v_new := v_item.quantity + NEW.change;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'Not enough stock: % in stock, % requested', v_item.quantity, abs(NEW.change) USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.stock_move', 'on', true);
  UPDATE public.inventory_items SET quantity = v_new WHERE id = v_item.id;
  PERFORM set_config('app.stock_move', 'off', true);

  -- Raise a low-stock alert once, when the level crosses down to (or below) the reorder level.
  IF v_item.reorder_level > 0 AND v_new <= v_item.reorder_level AND v_item.quantity > v_item.reorder_level THEN
    INSERT INTO public.inventory_alerts (tenant_id, kind, item_id, message)
    VALUES (NEW.tenant_id, 'low_stock', v_item.id,
      format('Low stock: %s has %s%s left (reorder level %s%s)', v_item.name,
             trim_scale(v_new), CASE WHEN v_item.unit = 'm' THEN ' m' ELSE '' END,
             trim_scale(v_item.reorder_level), CASE WHEN v_item.unit = 'm' THEN ' m' ELSE '' END));
  END IF;

  NEW.created_by := auth.uid();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stock_movements_apply ON public.stock_movements;
CREATE TRIGGER stock_movements_apply BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.stock_movements_apply();

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_items','inventory_devices','stock_movements','inventory_device_events','inventory_alerts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s require aal2" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s require aal2" ON public.%1$I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (public.is_aal2()) WITH CHECK (public.is_aal2())', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s select by role" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s select by role" ON public.%1$I FOR SELECT TO authenticated USING ('
      'public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''tenant_admin'',''technician'',''support_staff'']::public.app_role[]))', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['inventory_items','inventory_devices'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s insert by role" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s insert by role" ON public.%1$I FOR INSERT TO authenticated WITH CHECK ('
      'public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''tenant_admin'',''technician'']::public.app_role[]))', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s update by role" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s update by role" ON public.%1$I FOR UPDATE TO authenticated USING ('
      'public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''tenant_admin'',''technician'']::public.app_role[])) WITH CHECK ('
      'public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''tenant_admin'',''technician'']::public.app_role[]))', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s delete by role" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s delete by role" ON public.%1$I FOR DELETE TO authenticated USING ('
      'public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''tenant_admin'',''technician'']::public.app_role[]))', t);
  END LOOP;
END $$;

-- The ledger is append-only: insert, but never update or delete.
DROP POLICY IF EXISTS "stock_movements insert by role" ON public.stock_movements;
CREATE POLICY "stock_movements insert by role" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician']::public.app_role[]));

-- Alert settings: tenant admins only (they hold the phone numbers alerts are sent to).
ALTER TABLE public.alert_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "alert_settings require aal2" ON public.alert_settings;
CREATE POLICY "alert_settings require aal2" ON public.alert_settings AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2()) WITH CHECK (public.is_aal2());
DROP POLICY IF EXISTS "alert_settings select by role" ON public.alert_settings;
CREATE POLICY "alert_settings select by role" ON public.alert_settings FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]));
DROP POLICY IF EXISTS "alert_settings insert by role" ON public.alert_settings;
CREATE POLICY "alert_settings insert by role" ON public.alert_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]));
DROP POLICY IF EXISTS "alert_settings update by role" ON public.alert_settings;
CREATE POLICY "alert_settings update by role" ON public.alert_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]))
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]));
REVOKE DELETE ON public.alert_settings FROM authenticated, anon;
REVOKE ALL ON public.alert_settings FROM anon;

-- Device events, alerts and device monitoring readings are written by the platform (service role).
REVOKE INSERT, UPDATE, DELETE ON public.inventory_alerts FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_device_events FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.stock_movements FROM authenticated, anon;
REVOKE ALL ON public.inventory_items, public.inventory_devices, public.stock_movements, public.inventory_device_events, public.inventory_alerts FROM anon;

-- Live monitoring readings (online, loss_pct, last_*_at, status_changed_at) are written only by the
-- platform's router-report endpoint. Browsers may set everything else.
REVOKE INSERT, UPDATE ON public.inventory_devices FROM authenticated;
GRANT INSERT (id, tenant_id, item_id, category, name, brand, model, serial_number, mac_address, ip_address,
              status, customer_id, location, notes, monitor_enabled, monitor_router_id)
  ON public.inventory_devices TO authenticated;
GRANT UPDATE (item_id, category, name, brand, model, serial_number, mac_address, ip_address,
              status, customer_id, location, notes, monitor_enabled, monitor_router_id)
  ON public.inventory_devices TO authenticated;
-- END MIGRATION: supabase/migrations/20261025100000_inventory.sql

-- BEGIN MIGRATION: supabase/migrations/20261026000000_payment_provider.sql
-- Support more than one payment gateway (PayHero today, IntaSend added).
--   platform_mpesa_config.active_provider : which gateway new checkouts use (super admin setting)
--   payments.provider                     : which gateway handled each payment, so webhooks and
--                                           status checks are verified with the right one
-- merchant_request_id keeps holding the gateway's own reference (PayHero reference / IntaSend invoice_id).
ALTER TABLE public.platform_mpesa_config
  ADD COLUMN IF NOT EXISTS active_provider text NOT NULL DEFAULT 'payhero'
  CONSTRAINT platform_mpesa_config_active_provider_check CHECK (active_provider IN ('payhero', 'intasend'));

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'payhero'
  CONSTRAINT payments_provider_check CHECK (provider IN ('payhero', 'intasend'));

-- One IntaSend invoice can settle only one payment, even if a webhook is replayed or forged.
CREATE UNIQUE INDEX IF NOT EXISTS payments_intasend_invoice_key
  ON public.payments (merchant_request_id)
  WHERE provider = 'intasend' AND merchant_request_id IS NOT NULL;
-- END MIGRATION: supabase/migrations/20261026000000_payment_provider.sql

-- BEGIN MIGRATION: supabase/migrations/20261027000000_default_intasend.sql
-- IntaSend becomes the default payment gateway.
--   * new installs / missing config row: active_provider defaults to 'intasend'
--   * the existing platform setting is switched to IntaSend
-- Safe to deploy before the IntaSend keys exist: while INTASEND_SECRET_KEY is not set, the server
-- keeps using PayHero (resolveProvider falls back to whichever gateway is configured), and starts
-- using IntaSend as soon as the key is added. Payments already started keep the gateway recorded in
-- payments.provider, so in-flight PayHero payments still complete. To go back, pick PayHero on
-- Super admin -> Platform Payments.
ALTER TABLE public.platform_mpesa_config ALTER COLUMN active_provider SET DEFAULT 'intasend';

UPDATE public.platform_mpesa_config SET active_provider = 'intasend' WHERE active_provider <> 'intasend';
-- END MIGRATION: supabase/migrations/20261027000000_default_intasend.sql

-- BEGIN MIGRATION: supabase/migrations/20261028000000_platform_gateway_secrets.sql
-- Payment gateway credentials entered on Super admin -> Platform Payments.
--
-- Stored ENCRYPTED (AES-256-GCM, done in the server; see src/lib/gateway-secrets.server.ts) and readable
-- by NOTHING except the server's service role. RLS is on with no policies, and every grant to the browser
-- roles is revoked, so even a super admin's own session cannot SELECT it: the dashboard only ever gets
-- "is it set / last 4 characters / sandbox or live".
--
-- An INTASEND_* environment variable still works as a fallback when nothing is stored here.

CREATE TABLE IF NOT EXISTS public.platform_gateway_secrets (
  name        text PRIMARY KEY CHECK (name IN ('INTASEND_SECRET_KEY', 'INTASEND_WEBHOOK_CHALLENGE')),
  ciphertext  text NOT NULL,
  last4       text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

ALTER TABLE public.platform_gateway_secrets ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: with RLS on and none defined, non-service roles see no rows and can write none.

REVOKE ALL ON public.platform_gateway_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_gateway_secrets TO service_role;
-- END MIGRATION: supabase/migrations/20261028000000_platform_gateway_secrets.sql

-- BEGIN MIGRATION: supabase/migrations/20261029000000_gateway_secrets_publishable_key.sql
-- Allow the IntaSend API (publishable) key to be stored alongside the secret key and webhook challenge.
-- A separate migration, because 20261028000000 may already have been applied and applied migrations are
-- never re-run. The name list is the only thing that changes.
ALTER TABLE public.platform_gateway_secrets
  DROP CONSTRAINT IF EXISTS platform_gateway_secrets_name_check;

ALTER TABLE public.platform_gateway_secrets
  ADD CONSTRAINT platform_gateway_secrets_name_check
  CHECK (name IN ('INTASEND_SECRET_KEY', 'INTASEND_PUBLISHABLE_KEY', 'INTASEND_WEBHOOK_CHALLENGE'));
-- END MIGRATION: supabase/migrations/20261029000000_gateway_secrets_publishable_key.sql

-- BEGIN MIGRATION: supabase/migrations/20261030000000_router_last_sync.sql
-- When the router's sync script was last generated for it (the database snapshot it was built from).
-- Shown on the router page so it is obvious whether a router is receiving vouchers and PPPoE users:
-- "never" or "days ago" means customers created since then cannot connect.
ALTER TABLE public.routers ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;
-- END MIGRATION: supabase/migrations/20261030000000_router_last_sync.sql

-- BEGIN MIGRATION: supabase/migrations/20261031000000_optional_mfa_aal2.sql
-- Allow admins to optionally activate or disable Two-Factor Authentication (MFA).
-- Previously, is_aal2() strictly required auth.jwt() ->> 'aal' = 'aal2'.
-- When an admin chose to disable MFA, their session was at 'aal1', causing
-- the restrictive RLS policies on all business tables to hide all rows.
--
-- This update checks whether the caller has an active, verified MFA factor in auth.mfa_factors.
-- If the admin has MFA enabled: aal2 is strictly required.
-- If the admin has MFA disabled (no verified factor): the aal1 password session is permitted.

CREATE OR REPLACE FUNCTION public.is_aal2()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text;
  v_aal text;
  v_uid uuid;
  v_has_mfa boolean;
BEGIN
  -- Service role bypasses MFA check
  v_role := auth.jwt() ->> 'role';
  IF v_role = 'service_role' THEN
    RETURN true;
  END IF;

  -- If token has aal2, MFA challenge was completed and verified
  v_aal := auth.jwt() ->> 'aal';
  IF v_aal = 'aal2' THEN
    RETURN true;
  END IF;

  -- Caller's user ID
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Check if user has an active/verified MFA factor enrolled
  IF to_regclass('auth.mfa_factors') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM auth.mfa_factors
       WHERE user_id = v_uid
         AND status = 'verified'
    ) INTO v_has_mfa;

    -- If user has active MFA enrolled, require them to finish the MFA challenge (aal2)
    IF v_has_mfa THEN
      RETURN false;
    END IF;
  END IF;

  -- User does not have MFA enabled: aal1 session is fully authorized
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.is_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_aal2() TO authenticated, service_role;
-- END MIGRATION: supabase/migrations/20261031000000_optional_mfa_aal2.sql

-- BEGIN MIGRATION: supabase/migrations/20261031010000_audit_logs.sql
-- Audit logs for Super Admin and Tenant Admins
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  actor_role text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  description text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_id_idx ON public.audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON public.audit_logs (action);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Restrictive aal2 policy (respects is_aal2() so MFA-disabled accounts still have access)
DROP POLICY IF EXISTS "audit_logs require aal2" ON public.audit_logs;
CREATE POLICY "audit_logs require aal2" ON public.audit_logs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2()) WITH CHECK (public.is_aal2());

-- Super Admin can read all audit logs
DROP POLICY IF EXISTS "audit_logs super admin read" ON public.audit_logs;
CREATE POLICY "audit_logs super admin read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Tenant staff can read their own tenant's audit logs
DROP POLICY IF EXISTS "audit_logs tenant read" ON public.audit_logs;
CREATE POLICY "audit_logs tenant read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL AND (
      tenant_id = public.user_tenant_id(auth.uid()) OR
      public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[])
    )
  );

-- Authenticated users can insert audit logs for their own actions / tenant
DROP POLICY IF EXISTS "audit_logs insert" ON public.audit_logs;
CREATE POLICY "audit_logs insert" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid()) OR
    tenant_id IS NULL OR
    tenant_id = public.user_tenant_id(auth.uid())
  );
-- END MIGRATION: supabase/migrations/20261031010000_audit_logs.sql

-- BEGIN MIGRATION: supabase/migrations/20261101000000_tenant_owned_services.sql
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
-- END MIGRATION: supabase/migrations/20261101000000_tenant_owned_services.sql

-- BEGIN MIGRATION: supabase/migrations/20261102000000_daraja_only.sql
-- Remove non-Daraja payment paths. Keep completed historical records readable, but
-- fail old provider payments that were still waiting for a callback at cutover.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_provider_check;
UPDATE public.payments
SET status = 'failed'
WHERE provider IN ('intasend', 'payhero')
  AND status IN ('pending', 'processing');
ALTER TABLE public.payments
  ADD CONSTRAINT payments_provider_check
  CHECK (
    provider = 'daraja'
    OR (provider IN ('intasend', 'payhero') AND status IN ('success', 'failed'))
  );

DROP INDEX IF EXISTS public.payments_intasend_invoice_key;

ALTER TABLE public.platform_mpesa_config
  DROP CONSTRAINT IF EXISTS platform_mpesa_config_active_provider_check;
ALTER TABLE public.platform_mpesa_config
  DROP COLUMN IF EXISTS active_provider;

DROP TABLE IF EXISTS public.platform_gateway_secrets;
-- END MIGRATION: supabase/migrations/20261102000000_daraja_only.sql

-- BEGIN MIGRATION: supabase/migrations/20261103000000_capture_direct_c2b_transactions.sql
CREATE TABLE IF NOT EXISTS public.direct_mpesa_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shortcode text NOT NULL,
  transaction_id text NOT NULL UNIQUE,
  transaction_time timestamptz NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  bill_ref_number text,
  phone text,
  first_name text,
  middle_name text,
  last_name text,
  suggested_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'approved', 'rejected')),
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  raw_payload jsonb NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS direct_mpesa_transactions_tenant_status_time_idx
  ON public.direct_mpesa_transactions (tenant_id, status, transaction_time DESC);

ALTER TABLE public.direct_mpesa_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.direct_mpesa_transactions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.direct_mpesa_transactions FROM authenticated;
GRANT SELECT ON public.direct_mpesa_transactions TO authenticated;
GRANT ALL ON public.direct_mpesa_transactions TO service_role;

DROP POLICY IF EXISTS "direct M-Pesa transactions tenant read" ON public.direct_mpesa_transactions;
CREATE POLICY "direct M-Pesa transactions tenant read" ON public.direct_mpesa_transactions
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.user_tenant_id(auth.uid())
    OR public.is_super_admin(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.approve_direct_mpesa_transaction(
  p_transaction_id uuid,
  p_tenant_id uuid,
  p_customer_id uuid,
  p_package_id uuid,
  p_expires_at timestamptz,
  p_reviewed_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_transaction public.direct_mpesa_transactions%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_package public.packages%ROWTYPE;
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_transaction
  FROM public.direct_mpesa_transactions
  WHERE id = p_transaction_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND OR v_transaction.status <> 'received' THEN
    RAISE EXCEPTION 'This transaction is no longer awaiting review';
  END IF;

  SELECT * INTO v_customer
  FROM public.customers
  WHERE id = p_customer_id
    AND tenant_id = p_tenant_id
    AND customer_type = 'pppoe';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select a PPPoE customer belonging to this tenant';
  END IF;

  SELECT * INTO v_package
  FROM public.packages
  WHERE id = p_package_id
    AND tenant_id = p_tenant_id
    AND kind = 'pppoe'
    AND active IS TRUE;
  IF NOT FOUND
     OR v_package.price IS NULL
     OR ceil(v_package.price) <> v_transaction.amount THEN
    RAISE EXCEPTION 'The selected active PPPoE package price does not match this payment';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Invalid subscription expiry';
  END IF;

  INSERT INTO public.payments (
    tenant_id, customer_id, package_id, phone, amount, mpesa_receipt,
    status, provider, raw_callback, created_at, expires_at
  )
  VALUES (
    p_tenant_id, p_customer_id, p_package_id, v_transaction.phone,
    v_transaction.amount, v_transaction.transaction_id, 'success', 'daraja',
    v_transaction.raw_payload, v_transaction.transaction_time, p_expires_at
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.customers
  SET package_id = p_package_id,
      expires_at = p_expires_at,
      status = 'active'
  WHERE id = p_customer_id AND tenant_id = p_tenant_id;

  UPDATE public.direct_mpesa_transactions
  SET status = 'approved',
      customer_id = p_customer_id,
      payment_id = v_payment_id,
      reviewed_by = p_reviewed_by,
      reviewed_at = now()
  WHERE id = p_transaction_id;

  RETURN v_payment_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_direct_mpesa_transaction(uuid, uuid, uuid, uuid, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_direct_mpesa_transaction(uuid, uuid, uuid, uuid, timestamptz, uuid)
  TO service_role;
-- END MIGRATION: supabase/migrations/20261103000000_capture_direct_c2b_transactions.sql

-- BEGIN MIGRATION: supabase/migrations/20261104000000_mandatory_mfa.sql
-- Require an aal2 session for authenticated access to business tables. Previously, users without
-- an enrolled MFA factor were allowed to use aal1 sessions, so they could bypass the console gate.
CREATE OR REPLACE FUNCTION public.is_aal2()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT COALESCE(auth.jwt() ->> 'role' = 'service_role', false)
      OR COALESCE(auth.jwt() ->> 'aal' = 'aal2', false)
$$;

REVOKE ALL ON FUNCTION public.is_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_aal2() TO authenticated, service_role;
-- END MIGRATION: supabase/migrations/20261104000000_mandatory_mfa.sql

-- BEGIN MIGRATION: supabase/migrations/20261105000000_login_abuse_protection.sql
CREATE TABLE IF NOT EXISTS public.auth_login_attempts (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email_hash text NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  succeeded boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_login_attempts_email_time_idx
  ON public.auth_login_attempts (email_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS auth_login_attempts_ip_time_idx
  ON public.auth_login_attempts (ip_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS auth_login_attempts_time_idx
  ON public.auth_login_attempts (attempted_at);

ALTER TABLE public.auth_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_login_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.auth_login_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auth_login_attempts_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.check_auth_login_throttle(
  p_email_hash text,
  p_ip_hash text
)
RETURNS TABLE(blocked boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email_count integer;
  v_ip_count integer;
  v_email_oldest timestamptz;
  v_ip_oldest timestamptz;
  v_retry integer := 0;
BEGIN
  IF p_email_hash IS NULL OR p_ip_hash IS NULL
     OR p_email_hash !~ '^[0-9a-f]{64}$'
     OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid login throttle key';
  END IF;

  DELETE FROM public.auth_login_attempts
   WHERE id IN (
     SELECT id
       FROM public.auth_login_attempts
      WHERE attempted_at < now() - interval '180 days'
      ORDER BY attempted_at
      LIMIT 500
   );

  SELECT count(*)::integer, min(attempted_at)
    INTO v_email_count, v_email_oldest
    FROM public.auth_login_attempts
   WHERE email_hash = p_email_hash
     AND NOT succeeded
     AND attempted_at > now() - interval '15 minutes';

  SELECT count(*)::integer, min(attempted_at)
    INTO v_ip_count, v_ip_oldest
    FROM public.auth_login_attempts
   WHERE ip_hash = p_ip_hash
     AND NOT succeeded
     AND attempted_at > now() - interval '15 minutes';

  IF v_email_count >= 5 THEN
    v_retry := greatest(v_retry, ceil(extract(epoch FROM v_email_oldest + interval '15 minutes' - now()))::integer);
  END IF;
  IF v_ip_count >= 20 THEN
    v_retry := greatest(v_retry, ceil(extract(epoch FROM v_ip_oldest + interval '15 minutes' - now()))::integer);
  END IF;

  RETURN QUERY SELECT v_retry > 0, greatest(v_retry, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_auth_login_attempt(
  p_email_hash text,
  p_ip_hash text,
  p_succeeded boolean
)
RETURNS TABLE(attempt_count integer, should_alert boolean, event_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email_count integer;
  v_ip_count integer;
  v_known_login boolean := false;
  v_seen_ip boolean := false;
  v_should_alert boolean := false;
  v_event_type text := NULL;
  v_lock_key text;
BEGIN
  IF p_email_hash IS NULL OR p_ip_hash IS NULL
     OR p_email_hash !~ '^[0-9a-f]{64}$'
     OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid login throttle key';
  END IF;

  -- Serialize updates for this email/IP pair to avoid duplicate threshold alerts.
  v_lock_key := least('email:' || p_email_hash, 'ip:' || p_ip_hash);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
  v_lock_key := greatest('email:' || p_email_hash, 'ip:' || p_ip_hash);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  IF p_succeeded THEN
    SELECT EXISTS (
      SELECT 1 FROM public.auth_login_attempts
       WHERE email_hash = p_email_hash
         AND succeeded
         AND attempted_at > now() - interval '180 days'
    ) INTO v_known_login;
    SELECT EXISTS (
      SELECT 1 FROM public.auth_login_attempts
       WHERE email_hash = p_email_hash
         AND ip_hash = p_ip_hash
         AND succeeded
         AND attempted_at > now() - interval '30 days'
    ) INTO v_seen_ip;

    INSERT INTO public.auth_login_attempts (email_hash, ip_hash, succeeded)
    VALUES (p_email_hash, p_ip_hash, true);
    DELETE FROM public.auth_login_attempts
     WHERE email_hash = p_email_hash
       AND NOT succeeded;

    v_should_alert := v_known_login AND NOT v_seen_ip;
    IF v_should_alert THEN v_event_type := 'new_login_location'; END IF;
    RETURN QUERY SELECT 0, v_should_alert, v_event_type;
    RETURN;
  END IF;

  INSERT INTO public.auth_login_attempts (email_hash, ip_hash, succeeded)
  VALUES (p_email_hash, p_ip_hash, false);

  SELECT count(*)::integer
    INTO v_email_count
    FROM public.auth_login_attempts
   WHERE email_hash = p_email_hash
     AND NOT succeeded
     AND attempted_at > now() - interval '15 minutes';
  SELECT count(*)::integer
    INTO v_ip_count
    FROM public.auth_login_attempts
   WHERE ip_hash = p_ip_hash
     AND NOT succeeded
     AND attempted_at > now() - interval '15 minutes';

  v_should_alert := v_email_count = 5 OR v_ip_count = 20;
  IF v_should_alert THEN v_event_type := 'repeated_failed_logins'; END IF;
  RETURN QUERY SELECT v_email_count, v_should_alert, v_event_type;
END;
$$;

REVOKE ALL ON FUNCTION public.check_auth_login_throttle(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_auth_login_attempt(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_auth_login_throttle(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_auth_login_attempt(text, text, boolean) TO service_role;
-- END MIGRATION: supabase/migrations/20261105000000_login_abuse_protection.sql

-- BEGIN MIGRATION: supabase/migrations/20261107000000_pppoe_fup_usage.sql
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS fup_download_kbps integer NOT NULL DEFAULT 512,
  ADD COLUMN IF NOT EXISTS fup_upload_kbps integer NOT NULL DEFAULT 256;

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_fup_download_positive,
  DROP CONSTRAINT IF EXISTS packages_fup_upload_positive;
ALTER TABLE public.packages
  ADD CONSTRAINT packages_fup_download_positive CHECK (fup_download_kbps > 0),
  ADD CONSTRAINT packages_fup_upload_positive CHECK (fup_upload_kbps > 0);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS data_used_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_session_id text,
  ADD COLUMN IF NOT EXISTS usage_bytes_in bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_bytes_out bigint NOT NULL DEFAULT 0;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_data_used_bytes_nonnegative,
  DROP CONSTRAINT IF EXISTS customers_usage_bytes_in_nonnegative,
  DROP CONSTRAINT IF EXISTS customers_usage_bytes_out_nonnegative;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_data_used_bytes_nonnegative CHECK (data_used_bytes >= 0),
  ADD CONSTRAINT customers_usage_bytes_in_nonnegative CHECK (usage_bytes_in >= 0),
  ADD CONSTRAINT customers_usage_bytes_out_nonnegative CHECK (usage_bytes_out >= 0);

CREATE OR REPLACE FUNCTION public.guard_pppoe_usage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.data_used_bytes := 0;
      NEW.usage_session_id := NULL;
      NEW.usage_bytes_in := 0;
      NEW.usage_bytes_out := 0;
    ELSIF NEW.data_used_bytes IS DISTINCT FROM OLD.data_used_bytes
       OR NEW.usage_session_id IS DISTINCT FROM OLD.usage_session_id
       OR NEW.usage_bytes_in IS DISTINCT FROM OLD.usage_bytes_in
       OR NEW.usage_bytes_out IS DISTINCT FROM OLD.usage_bytes_out THEN
      RAISE EXCEPTION 'Usage is reported by the router and cannot be edited'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_pppoe_usage() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS guard_pppoe_usage ON public.customers;
CREATE TRIGGER guard_pppoe_usage
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_pppoe_usage();

CREATE OR REPLACE FUNCTION public.reset_pppoe_usage_on_renewal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.package_id IS DISTINCT FROM OLD.package_id
     OR (NEW.expires_at IS NOT NULL AND NEW.expires_at > COALESCE(OLD.expires_at, '-infinity')) THEN
    NEW.data_used_bytes := 0;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_pppoe_usage_on_renewal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS reset_pppoe_usage_on_renewal ON public.customers;
CREATE TRIGGER reset_pppoe_usage_on_renewal
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.reset_pppoe_usage_on_renewal();

CREATE OR REPLACE FUNCTION public.record_pppoe_sessions(
  p_router_id uuid,
  p_tenant_id uuid,
  p_sessions jsonb
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH incoming AS (
    SELECT
      x.username,
      x.mac,
      x.ip,
      x.session_id,
      CASE
        WHEN x.session_id ~ '^[A-Za-z0-9._:-]{1,128}$' THEN
          CASE WHEN x.bytes_in ~ '^[0-9]{1,19}$' THEN
            CASE WHEN x.bytes_in::numeric <= 9223372036854775807 THEN x.bytes_in::bigint END
          END
      END AS bytes_in,
      CASE
        WHEN x.session_id ~ '^[A-Za-z0-9._:-]{1,128}$' THEN
          CASE WHEN x.bytes_out ~ '^[0-9]{1,19}$' THEN
            CASE WHEN x.bytes_out::numeric <= 9223372036854775807 THEN x.bytes_out::bigint END
          END
      END AS bytes_out
    FROM jsonb_to_recordset(p_sessions) AS x(
      username text,
      mac text,
      ip text,
      session_id text,
      bytes_in text,
      bytes_out text
    )
    LIMIT 500
  ), updated AS (
    UPDATE public.customers c
       SET last_mac = s.mac,
           last_ip = s.ip,
           last_seen_at = now(),
           last_router_id = p_router_id,
           data_used_bytes = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.data_used_bytes
             WHEN c.usage_session_id = s.session_id THEN
               c.data_used_bytes
               + greatest(s.bytes_in - c.usage_bytes_in, 0)
               + greatest(s.bytes_out - c.usage_bytes_out, 0)
             WHEN c.usage_session_id IS NULL THEN c.data_used_bytes
             ELSE c.data_used_bytes + s.bytes_in + s.bytes_out
           END,
           usage_session_id = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.usage_session_id
             ELSE s.session_id
           END,
           usage_bytes_in = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.usage_bytes_in
             WHEN c.usage_session_id = s.session_id THEN greatest(c.usage_bytes_in, s.bytes_in)
             ELSE s.bytes_in
           END,
           usage_bytes_out = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.usage_bytes_out
             WHEN c.usage_session_id = s.session_id THEN greatest(c.usage_bytes_out, s.bytes_out)
             ELSE s.bytes_out
           END
      FROM incoming s
     WHERE c.tenant_id = p_tenant_id
       AND c.customer_type = 'pppoe'
       AND c.pppoe_username = s.username
       AND (c.router_id IS NULL OR c.router_id = p_router_id)
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated;
$$;
REVOKE ALL ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) TO service_role;
-- END MIGRATION: supabase/migrations/20261107000000_pppoe_fup_usage.sql

-- BEGIN MIGRATION: supabase/migrations/20261108000000_platform_commission_invoices.sql
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS billing_suspended_at timestamptz;

CREATE OR REPLACE FUNCTION public.protect_tenant_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.slug IS DISTINCT FROM OLD.slug
       OR NEW.subdomain IS DISTINCT FROM OLD.subdomain
       OR NEW.platform_commission_pct IS DISTINCT FROM OLD.platform_commission_pct
       OR NEW.billing_suspended_at IS DISTINCT FROM OLD.billing_suspended_at
       OR NEW.mpesa_shortcode IS DISTINCT FROM OLD.mpesa_shortcode
       OR NEW.mpesa_consumer_key IS DISTINCT FROM OLD.mpesa_consumer_key
       OR NEW.mpesa_consumer_secret IS DISTINCT FROM OLD.mpesa_consumer_secret
       OR NEW.mpesa_passkey IS DISTINCT FROM OLD.mpesa_passkey
       OR NEW.mpesa_env IS DISTINCT FROM OLD.mpesa_env
    THEN
      RAISE EXCEPTION 'Only platform admins can change this field' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.platform_billing_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  commission_tracking_starts_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_billing_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.platform_billing_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_billing_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_billing_config TO service_role;

ALTER TABLE public.platform_commissions
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS commission_rate_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_error text,
  ADD COLUMN IF NOT EXISTS email_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

ALTER TABLE public.platform_commissions
  DROP CONSTRAINT IF EXISTS platform_commissions_email_status_check;
ALTER TABLE public.platform_commissions
  ADD CONSTRAINT platform_commissions_email_status_check
  CHECK (email_status IN ('pending', 'sending', 'sent', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS platform_commissions_invoice_number_key
  ON public.platform_commissions (invoice_number)
  WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_commissions_overdue_idx
  ON public.platform_commissions (due_at, tenant_id)
  WHERE status = 'pending' AND due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_commissions_email_queue_idx
  ON public.platform_commissions (email_status, created_at)
  WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_success_created_at_idx
  ON public.payments (created_at, tenant_id)
  WHERE status = 'success';

DROP POLICY IF EXISTS "platform commissions tenant billing read" ON public.platform_commissions;
CREATE POLICY "platform commissions tenant billing read" ON public.platform_commissions
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.user_tenant_id(auth.uid())
    OR public.is_super_admin(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.generate_monthly_platform_commission_invoices(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_month timestamp;
  v_month timestamp;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_tenant record;
  v_existing public.platform_commissions%ROWTYPE;
  v_tracking_start timestamptz;
  v_invoice_number text;
  v_count integer := 0;
BEGIN
  v_local_month := date_trunc('month', p_now AT TIME ZONE 'Africa/Nairobi');
  SELECT commission_tracking_starts_at
  INTO v_tracking_start
  FROM public.platform_billing_config
  WHERE id = 1;

  FOR v_month IN
    SELECT DISTINCT date_trunc('month', p.created_at AT TIME ZONE 'Africa/Nairobi')
    FROM public.payments p
    WHERE p.status = 'success'
      AND p.created_at >= v_tracking_start
      AND p.created_at < (v_local_month AT TIME ZONE 'Africa/Nairobi')
    ORDER BY 1
  LOOP
    v_period_start := v_month AT TIME ZONE 'Africa/Nairobi';
    v_period_end := (v_month + interval '1 month') AT TIME ZONE 'Africa/Nairobi';

    FOR v_tenant IN
      SELECT
        t.id,
        t.slug,
        t.platform_commission_pct,
        sum(p.amount)::numeric(14,2) AS gross_amount,
        round(sum(p.amount) * t.platform_commission_pct / 100, 2)::numeric(14,2)
          AS commission_amount
      FROM public.payments p
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.status = 'success'
        AND p.created_at >= GREATEST(v_period_start, v_tracking_start)
        AND p.created_at < v_period_end
      GROUP BY t.id, t.slug, t.platform_commission_pct
      HAVING round(sum(p.amount) * t.platform_commission_pct / 100, 2) > 0
    LOOP
      v_invoice_number :=
        'INV-' || to_char(v_month, 'YYYYMM') || '-' ||
        upper(replace(v_tenant.id::text, '-', ''));

      SELECT pc.*
      INTO v_existing
      FROM public.platform_commissions pc
      WHERE pc.tenant_id = v_tenant.id
        AND pc.period_start < v_period_end
        AND pc.period_end >= v_period_start
      ORDER BY (pc.status = 'collected') DESC, pc.created_at
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        IF v_existing.status <> 'collected' AND v_existing.invoice_number IS NULL THEN
          UPDATE public.platform_commissions
          SET period_start = v_period_start,
              period_end = v_period_end,
              gross_amount = v_tenant.gross_amount,
              commission_amount = v_tenant.commission_amount,
              commission_rate_pct = v_tenant.platform_commission_pct,
              invoice_number = COALESCE(invoice_number, v_invoice_number),
              issued_at = COALESCE(issued_at, p_now),
              due_at = COALESCE(due_at, p_now + interval '72 hours'),
              email_status = CASE
                WHEN invoice_number IS NULL THEN 'pending'
                ELSE email_status
              END
          WHERE id = v_existing.id;
          v_count := v_count + 1;
        END IF;
      ELSE
        INSERT INTO public.platform_commissions (
          tenant_id,
          period_start,
          period_end,
          gross_amount,
          commission_amount,
          commission_rate_pct,
          invoice_number,
          issued_at,
          due_at,
          status,
          email_status
        )
        VALUES (
          v_tenant.id,
          v_period_start,
          v_period_end,
          v_tenant.gross_amount,
          v_tenant.commission_amount,
          v_tenant.platform_commission_pct,
          v_invoice_number,
          p_now,
          p_now + interval '72 hours',
          'pending',
          'pending'
        )
        ON CONFLICT (tenant_id, period_start, period_end) DO NOTHING;
        IF FOUND THEN
          v_count := v_count + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION public.refresh_overdue_tenant_billing(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.tenants t
  SET billing_suspended_at = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.platform_commissions pc
      WHERE pc.tenant_id = t.id
        AND pc.status = 'pending'
        AND pc.due_at IS NOT NULL
        AND pc.due_at <= p_now
    ) THEN COALESCE(t.billing_suspended_at, p_now)
    ELSE NULL
  END
  WHERE t.billing_suspended_at IS DISTINCT FROM CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.platform_commissions pc
      WHERE pc.tenant_id = t.id
        AND pc.status = 'pending'
        AND pc.due_at IS NOT NULL
        AND pc.due_at <= p_now
    ) THEN COALESCE(t.billing_suspended_at, p_now)
    ELSE NULL
  END;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION public.claim_platform_invoice_emails(
  p_limit integer DEFAULT 50,
  p_now timestamptz DEFAULT now()
)
RETURNS SETOF public.platform_commissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT pc.id
    FROM public.platform_commissions pc
    WHERE pc.invoice_number IS NOT NULL
      AND (
        pc.email_status IN ('pending', 'failed')
        OR (pc.email_status = 'sending' AND pc.email_attempted_at < p_now - interval '30 minutes')
      )
    ORDER BY pc.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.platform_commissions pc
  SET email_status = 'sending',
      email_error = NULL,
      email_attempted_at = p_now
  FROM candidates c
  WHERE pc.id = c.id
  RETURNING pc.*;
END
$$;

CREATE OR REPLACE FUNCTION public.refresh_billing_after_commission_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_overdue_tenant_billing();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS platform_commissions_refresh_billing ON public.platform_commissions;
CREATE TRIGGER platform_commissions_refresh_billing
  AFTER UPDATE OF status ON public.platform_commissions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.refresh_billing_after_commission_update();

CREATE OR REPLACE FUNCTION public.enforce_tenant_billing_service_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_restricted boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT t.status = 'suspended' OR t.billing_suspended_at IS NOT NULL
  INTO v_restricted
  FROM public.tenants t
  WHERE t.id = NEW.tenant_id;

  IF COALESCE(v_restricted, false) THEN
    RAISE EXCEPTION 'Tenant customer service is paused while its commission invoice is overdue'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS customers_require_current_tenant_billing ON public.customers;
CREATE TRIGGER customers_require_current_tenant_billing
  BEFORE INSERT OR UPDATE OF status ON public.customers
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.enforce_tenant_billing_service_access();

DROP TRIGGER IF EXISTS vouchers_require_current_tenant_billing ON public.vouchers;
CREATE TRIGGER vouchers_require_current_tenant_billing
  BEFORE INSERT OR UPDATE OF status ON public.vouchers
  FOR EACH ROW
  WHEN (NEW.status IN ('unused', 'used'))
  EXECUTE FUNCTION public.enforce_tenant_billing_service_access();

DROP TRIGGER IF EXISTS tv_devices_require_current_tenant_billing ON public.tv_devices;
CREATE TRIGGER tv_devices_require_current_tenant_billing
  BEFORE INSERT OR UPDATE OF status ON public.tv_devices
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.enforce_tenant_billing_service_access();

REVOKE ALL ON FUNCTION public.generate_monthly_platform_commission_invoices(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_overdue_tenant_billing(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_platform_invoice_emails(integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_billing_after_commission_update()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_tenant_billing_service_access()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_monthly_platform_commission_invoices(timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_overdue_tenant_billing(timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_platform_invoice_emails(integer, timestamptz)
  TO service_role;

DO $platform_billing_schedule$
DECLARE
  v_net_schema text;
  v_job_id bigint;
BEGIN
  SELECT n.nspname
  INTO v_net_schema
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'http_post'
    AND n.nspname IN ('net', 'extensions')
  ORDER BY (n.nspname = 'net') DESC
  LIMIT 1;

  IF to_regclass('cron.job') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR v_net_schema IS NULL THEN
    RAISE NOTICE 'Database billing scheduler extensions are unavailable; call /api/cron/platform-billing from an external scheduler every 15 minutes';
    RETURN;
  END IF;

  EXECUTE format($function$
    CREATE OR REPLACE FUNCTION public.invoke_platform_billing_job()
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, vault, %I
    AS $body$
    DECLARE
      v_app_url text;
      v_cron_secret text;
      v_request_id bigint;
    BEGIN
      SELECT decrypted_secret INTO v_app_url
      FROM vault.decrypted_secrets
      WHERE name = 'platform_billing_app_url'
      ORDER BY updated_at DESC
      LIMIT 1;

      SELECT decrypted_secret INTO v_cron_secret
      FROM vault.decrypted_secrets
      WHERE name = 'platform_billing_cron_secret'
      ORDER BY updated_at DESC
      LIMIT 1;

      IF COALESCE(v_app_url, '') = '' OR COALESCE(v_cron_secret, '') = '' THEN
        RAISE WARNING 'Platform billing job is not configured; add the app URL and cron secret to Supabase Vault';
        RETURN NULL;
      END IF;

      v_request_id := %I.http_post(
        url := rtrim(v_app_url, '/') || '/api/cron/platform-billing',
        body := '{}'::jsonb,
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'authorization', 'Bearer ' || v_cron_secret
        ),
        timeout_milliseconds := 30000
      );
      RETURN v_request_id;
    END
    $body$;
  $function$, v_net_schema, v_net_schema);

  REVOKE ALL ON FUNCTION public.invoke_platform_billing_job()
    FROM PUBLIC, anon, authenticated;

  FOR v_job_id IN
    EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1'
      USING 'platform-billing-invoices'
  LOOP
    EXECUTE format('SELECT cron.unschedule(%s)', v_job_id);
  END LOOP;

  EXECUTE $schedule$
    SELECT cron.schedule(
      'platform-billing-invoices',
      '*/15 * * * *',
      'SELECT public.invoke_platform_billing_job()'
    )
  $schedule$;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not configure the database billing scheduler (%); call /api/cron/platform-billing from an external scheduler every 15 minutes', SQLERRM;
END
$platform_billing_schedule$;
-- END MIGRATION: supabase/migrations/20261108000000_platform_commission_invoices.sql

-- BEGIN MIGRATION: supabase/migrations/20261109000000_tenant_mfa_toggle.sql
-- Allow tenant administrators and users to enable or disable Two-Factor Authentication (MFA).
-- When MFA is enabled (user has verified factors in auth.mfa_factors): an aal2 session is strictly enforced.
-- When MFA is disabled (no verified factor enrolled): the aal1 password session is permitted.

CREATE OR REPLACE FUNCTION public.is_aal2()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text;
  v_aal text;
  v_uid uuid;
  v_has_mfa boolean;
BEGIN
  -- Service role bypasses MFA check
  v_role := auth.jwt() ->> 'role';
  IF v_role = 'service_role' THEN
    RETURN true;
  END IF;

  -- If token has aal2, MFA challenge was completed and verified
  v_aal := auth.jwt() ->> 'aal';
  IF v_aal = 'aal2' THEN
    RETURN true;
  END IF;

  -- Caller's user ID
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Check if user has an active/verified MFA factor enrolled
  IF to_regclass('auth.mfa_factors') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM auth.mfa_factors
       WHERE user_id = v_uid
         AND status = 'verified'
    ) INTO v_has_mfa;

    -- If user has active MFA enrolled, require them to finish the MFA challenge (aal2)
    IF v_has_mfa THEN
      RETURN false;
    END IF;
  END IF;

  -- User does not have MFA enabled: aal1 session is fully authorized
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.is_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_aal2() TO authenticated, service_role;
-- END MIGRATION: supabase/migrations/20261109000000_tenant_mfa_toggle.sql

-- BEGIN MIGRATION: supabase/migrations/20261110000000_tenant_portal_redirect.sql
ALTER TABLE public.captive_portals
  ADD COLUMN IF NOT EXISTS post_login_url text;
-- END MIGRATION: supabase/migrations/20261110000000_tenant_portal_redirect.sql

-- BEGIN MIGRATION: supabase/migrations/20261111000000_lock_bootstrap_tenant.sql
-- SECURITY: public.bootstrap_tenant() was executable by every signed-in user. It is SECURITY DEFINER and its
-- only check is "this user has no workspace yet", which is true for every brand-new sign-up. So anyone who
-- created an account could call it through the API and instantly become tenant_admin of a workspace they just
-- invented, skipping the super-admin approval step (the app never calls this function; approval goes through
-- admin_approve_user). Browser roles can no longer call it. The server's service role still can.
--
-- The two trigger functions below are only ever run by their triggers. They were granted to anon/authenticated by
-- Supabase's default privileges. Calling them directly already fails, but they should not be callable at all.
--
-- Safe to re-run. REVOKE does not drop anything: triggers keep working (EXECUTE is only checked when a trigger
-- is created, not when it fires).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('bootstrap_tenant', 'inventory_devices_guard', 'stock_movements_apply')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;
-- END MIGRATION: supabase/migrations/20261111000000_lock_bootstrap_tenant.sql

-- BEGIN MIGRATION: supabase/migrations/20261111010000_hotspot_outage_recovery.sql
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS router_id uuid REFERENCES public.routers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payments_tenant_router_idx
  ON public.payments (tenant_id, router_id, created_at DESC)
  WHERE router_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.hotspot_payment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  mac text NOT NULL CHECK (mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  connected_seconds integer NOT NULL DEFAULT 0 CHECK (connected_seconds >= 0),
  completed_seconds integer NOT NULL DEFAULT 0 CHECK (completed_seconds >= 0),
  last_router_uptime_seconds integer NOT NULL DEFAULT 0 CHECK (last_router_uptime_seconds >= 0),
  active boolean NOT NULL DEFAULT false,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, router_id, mac)
);

CREATE INDEX IF NOT EXISTS hotspot_payment_sessions_outage_idx
  ON public.hotspot_payment_sessions (tenant_id, router_id, last_active_at DESC);

CREATE TABLE IF NOT EXISTS public.hotspot_payment_session_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  mac text NOT NULL CHECK (mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  connected_seconds integer NOT NULL CHECK (connected_seconds >= 0),
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hotspot_payment_session_samples_outage_idx
  ON public.hotspot_payment_session_samples (tenant_id, router_id, payment_id, observed_at DESC);

CREATE OR REPLACE FUNCTION public.get_hotspot_outage_usage(
  p_tenant_id uuid,
  p_router_id uuid,
  p_payment_ids uuid[],
  p_outage_started_at timestamptz
)
RETURNS TABLE(
  payment_id uuid,
  has_usage boolean,
  was_active boolean,
  connected_seconds integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH latest_device_samples AS (
    SELECT DISTINCT ON (sample.payment_id, sample.mac)
      sample.payment_id,
      sample.mac,
      sample.connected_seconds,
      sample.observed_at
    FROM public.hotspot_payment_session_samples AS sample
    WHERE sample.tenant_id = p_tenant_id
      AND sample.router_id = p_router_id
      AND sample.payment_id = ANY(p_payment_ids)
      AND sample.observed_at <= p_outage_started_at
      AND sample.observed_at >= p_outage_started_at - interval '90 days'
    ORDER BY sample.payment_id, sample.mac, sample.observed_at DESC
  ),
  payment_usage AS (
    SELECT
      sample.payment_id,
      true AS has_usage,
      bool_or(sample.observed_at >= p_outage_started_at - interval '2 minutes') AS was_active,
      max(sample.connected_seconds) AS connected_seconds
    FROM latest_device_samples AS sample
    GROUP BY sample.payment_id
  )
  SELECT
    requested.payment_id,
    COALESCE(usage.has_usage, false),
    COALESCE(usage.was_active, false),
    COALESCE(usage.connected_seconds, 0)::integer
  FROM unnest(p_payment_ids) AS requested(payment_id)
  LEFT JOIN payment_usage AS usage USING (payment_id);
$$;

CREATE TABLE IF NOT EXISTS public.hotspot_recovery_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  outage_started_at timestamptz NOT NULL,
  outage_ended_at timestamptz NOT NULL,
  recovery_mode text NOT NULL CHECK (recovery_mode IN ('tracked', 'manual')),
  reason text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outage_ended_at > outage_started_at)
);

CREATE TABLE IF NOT EXISTS public.hotspot_recovery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.hotspot_recovery_batches(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  connected_seconds integer NOT NULL CHECK (connected_seconds >= 0),
  restored_seconds integer NOT NULL CHECK (restored_seconds > 0),
  estimated boolean NOT NULL DEFAULT false,
  previous_expires_at timestamptz NOT NULL,
  new_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, payment_id)
);

ALTER TABLE public.hotspot_payment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotspot_payment_session_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotspot_recovery_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotspot_recovery_items ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.hotspot_payment_sessions TO service_role;
GRANT ALL ON public.hotspot_payment_session_samples TO service_role;
GRANT ALL ON public.hotspot_recovery_batches TO service_role;
GRANT ALL ON public.hotspot_recovery_items TO service_role;

CREATE OR REPLACE FUNCTION public.apply_hotspot_outage_recovery(
  p_tenant_id uuid,
  p_router_id uuid,
  p_outage_started_at timestamptz,
  p_outage_ended_at timestamptz,
  p_recovery_mode text,
  p_reason text,
  p_created_by uuid,
  p_items jsonb
)
RETURNS TABLE(batch_id uuid, payment_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id uuid;
  v_item jsonb;
  v_payment public.payments%ROWTYPE;
  v_payment_id uuid;
  v_connected_seconds integer;
  v_restored_seconds integer;
  v_estimated boolean;
  v_new_expires_at timestamptz;
  v_count integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Invalid hotspot recovery items';
  END IF;

  IF p_outage_ended_at <= p_outage_started_at
    OR p_outage_ended_at > now()
    OR p_recovery_mode NOT IN ('tracked', 'manual')
    OR length(trim(p_reason)) < 3
    OR jsonb_array_length(p_items) < 1
    OR jsonb_array_length(p_items) > 500
  THEN
    RAISE EXCEPTION 'Invalid hotspot recovery request';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.routers
    WHERE id = p_router_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'The recovery router does not belong to this tenant';
  END IF;

  INSERT INTO public.hotspot_recovery_batches (
    tenant_id, router_id, outage_started_at, outage_ended_at,
    recovery_mode, reason, created_by
  )
  VALUES (
    p_tenant_id, p_router_id, p_outage_started_at, p_outage_ended_at,
    p_recovery_mode, trim(p_reason), p_created_by
  )
  RETURNING id INTO v_batch_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_payment_id := (v_item->>'paymentId')::uuid;
    v_connected_seconds := (v_item->>'connectedSeconds')::integer;
    v_restored_seconds := (v_item->>'restoredSeconds')::integer;
    v_estimated := COALESCE((v_item->>'estimated')::boolean, false);

    IF v_connected_seconds < 0 OR v_restored_seconds < 1 THEN
      RAISE EXCEPTION 'Invalid hotspot recovery duration';
    END IF;

    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = v_payment_id
      AND tenant_id = p_tenant_id
      AND status = 'success'
      AND provider = 'daraja'
      AND package_id IS NOT NULL
      AND expires_at IS NOT NULL
      AND (router_id IS NULL OR router_id = p_router_id)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected payment is no longer eligible';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.hotspot_recovery_items AS item
      JOIN public.hotspot_recovery_batches AS batch ON batch.id = item.batch_id
      WHERE item.payment_id = v_payment_id
        AND batch.outage_started_at <= p_outage_ended_at
        AND batch.outage_ended_at >= p_outage_started_at
    ) THEN
      RAISE EXCEPTION 'A selected payment has already been recovered for this outage';
    END IF;

    v_new_expires_at := now() + make_interval(secs => v_restored_seconds);

    UPDATE public.payments
    SET expires_at = v_new_expires_at
    WHERE id = v_payment_id AND tenant_id = p_tenant_id;

    INSERT INTO public.hotspot_recovery_items (
      batch_id, tenant_id, payment_id, connected_seconds, restored_seconds,
      estimated, previous_expires_at, new_expires_at
    )
    VALUES (
      v_batch_id, p_tenant_id, v_payment_id, v_connected_seconds, v_restored_seconds,
      v_estimated, v_payment.expires_at, v_new_expires_at
    );

    batch_id := v_batch_id;
    payment_id := v_payment_id;
    expires_at := v_new_expires_at;
    RETURN NEXT;
    v_count := v_count + 1;
  END LOOP;

  IF v_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'Not all selected payments were recovered';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_hotspot_outage_recovery(
  uuid, uuid, timestamptz, timestamptz, text, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_hotspot_outage_recovery(
  uuid, uuid, timestamptz, timestamptz, text, text, uuid, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.get_hotspot_outage_usage(uuid, uuid, uuid[], timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hotspot_outage_usage(uuid, uuid, uuid[], timestamptz)
  TO service_role;
-- END MIGRATION: supabase/migrations/20261111010000_hotspot_outage_recovery.sql

-- BEGIN MIGRATION: supabase/migrations/20261112000000_expire_stale_stk_payments.sql
CREATE OR REPLACE FUNCTION public.expire_stale_stk_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired integer;
BEGIN
  UPDATE public.payments
  SET status = 'failed'
  WHERE status = 'pending'
    AND created_at < now() - interval '10 minutes';

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END
$$;

REVOKE ALL ON FUNCTION public.expire_stale_stk_payments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_stk_payments() TO service_role;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron is unavailable; stale STK payments will be expired on checkout only';
    RETURN;
  END IF;

  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname = 'expire-stale-stk-payments' LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'expire-stale-stk-payments',
    '*/5 * * * *',
    'SELECT public.expire_stale_stk_payments()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule stale STK payment cleanup (%); enable pg_cron to run it every 5 minutes', SQLERRM;
END
$$;
-- END MIGRATION: supabase/migrations/20261112000000_expire_stale_stk_payments.sql

-- BEGIN MIGRATION: supabase/migrations/20261113000000_buygoods_stk_type.sql
ALTER TABLE public.tenant_service_secrets
  DROP CONSTRAINT IF EXISTS tenant_service_secrets_name_check;
ALTER TABLE public.tenant_service_secrets
  DROP CONSTRAINT IF EXISTS tenant_service_secrets_allowed_names_check;

ALTER TABLE public.tenant_service_secrets
  ADD CONSTRAINT tenant_service_secrets_allowed_names_check
  CHECK (name IN (
    'MPESA_ENV',
    'MPESA_MERCHANT_TYPE',
    'MPESA_SHORTCODE',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_PASSKEY',
    'AT_USERNAME',
    'AT_API_KEY',
    'AT_SENDER_ID'
  ));
-- END MIGRATION: supabase/migrations/20261113000000_buygoods_stk_type.sql

-- BEGIN MIGRATION: supabase/migrations/20261114000000_separate_stk_business_shortcode.sql
ALTER TABLE public.tenant_service_secrets
  DROP CONSTRAINT IF EXISTS tenant_service_secrets_allowed_names_check;
ALTER TABLE public.tenant_service_secrets
  DROP CONSTRAINT IF EXISTS tenant_service_secrets_business_shortcode_check;

ALTER TABLE public.tenant_service_secrets
  ADD CONSTRAINT tenant_service_secrets_business_shortcode_check
  CHECK (name IN (
    'MPESA_ENV',
    'MPESA_MERCHANT_TYPE',
    'MPESA_BUSINESS_SHORTCODE',
    'MPESA_SHORTCODE',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_PASSKEY',
    'AT_USERNAME',
    'AT_API_KEY',
    'AT_SENDER_ID'
  ));
-- END MIGRATION: supabase/migrations/20261114000000_separate_stk_business_shortcode.sql

-- BEGIN MIGRATION: supabase/migrations/20261115000000_router_support_sessions.sql
CREATE TABLE IF NOT EXISTS public.router_support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  access_count integer NOT NULL DEFAULT 0 CHECK (access_count >= 0),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS router_support_sessions_router_active_idx
  ON public.router_support_sessions (router_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS router_support_sessions_one_active_per_router_idx
  ON public.router_support_sessions (router_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.router_support_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.router_support_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.router_support_sessions TO service_role;
-- END MIGRATION: supabase/migrations/20261115000000_router_support_sessions.sql

-- BEGIN MIGRATION: supabase/migrations/20261116000000_multi_vendor_devices.sql
ALTER TABLE public.routers
  ADD COLUMN IF NOT EXISTS vendor text NOT NULL DEFAULT 'mikrotik',
  ADD COLUMN IF NOT EXISTS device_family text,
  ADD COLUMN IF NOT EXISTS controller_version text,
  ADD COLUMN IF NOT EXISTS management_method text,
  ADD COLUMN IF NOT EXISTS management_status text NOT NULL DEFAULT 'api_unavailable',
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.routers
  DROP CONSTRAINT IF EXISTS routers_vendor_check;
ALTER TABLE public.routers
  ADD CONSTRAINT routers_vendor_check
  CHECK (vendor IN ('mikrotik', 'ruijie_reyee', 'tp_link_omada'));

ALTER TABLE public.routers
  DROP CONSTRAINT IF EXISTS routers_management_status_check;
ALTER TABLE public.routers
  ADD CONSTRAINT routers_management_status_check
  CHECK (management_status IN (
    'online',
    'offline',
    'partially_supported',
    'api_unavailable',
    'authentication_failed',
    'successfully_provisioned'
  ));

UPDATE public.routers
SET management_method = COALESCE(management_method, 'routeros_agent'),
    management_status = CASE
      WHEN status = 'pending' THEN 'api_unavailable'
      ELSE 'successfully_provisioned'
    END,
    device_family = COALESCE(device_family, board_name, model),
    firmware_version = COALESCE(firmware_version, routeros_version),
    capabilities = '["health.read", "interfaces.read", "pppoe.configure", "guest_portal.voucher_sync"]'::jsonb
WHERE vendor = 'mikrotik'
  AND management_method IS NULL;
-- END MIGRATION: supabase/migrations/20261116000000_multi_vendor_devices.sql

-- BEGIN MIGRATION: supabase/migrations/20261117000000_tiered_platform_commissions.sql
ALTER TABLE public.platform_commissions
  ADD COLUMN IF NOT EXISTS hotspot_gross_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS pppoe_gross_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS hotspot_commission_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS pppoe_commission_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS hotspot_commission_rate_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS pppoe_commission_rate_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS tenant_mpesa_receipt text;

CREATE UNIQUE INDEX IF NOT EXISTS platform_commissions_tenant_receipt_key
  ON public.platform_commissions (tenant_mpesa_receipt)
  WHERE tenant_mpesa_receipt IS NOT NULL;

ALTER TABLE public.platform_commissions
  DROP CONSTRAINT IF EXISTS platform_commissions_tiered_amounts_check;
ALTER TABLE public.platform_commissions
  ADD CONSTRAINT platform_commissions_tiered_amounts_check
  CHECK (
    (
      hotspot_gross_amount IS NULL
      AND pppoe_gross_amount IS NULL
      AND hotspot_commission_amount IS NULL
      AND pppoe_commission_amount IS NULL
      AND hotspot_commission_rate_pct IS NULL
      AND pppoe_commission_rate_pct IS NULL
    )
    OR (
      hotspot_gross_amount IS NOT NULL
      AND pppoe_gross_amount IS NOT NULL
      AND hotspot_commission_amount IS NOT NULL
      AND pppoe_commission_amount IS NOT NULL
      AND hotspot_commission_rate_pct IS NOT NULL
      AND pppoe_commission_rate_pct IS NOT NULL
      AND hotspot_commission_rate_pct = 2
      AND pppoe_commission_rate_pct = 1
      AND hotspot_gross_amount >= 0
      AND pppoe_gross_amount >= 0
      AND hotspot_commission_amount >= 0
      AND pppoe_commission_amount >= 0
      AND hotspot_commission_amount =
        round(hotspot_gross_amount * hotspot_commission_rate_pct / 100, 2)
      AND pppoe_commission_amount =
        round(pppoe_gross_amount * pppoe_commission_rate_pct / 100, 2)
      AND gross_amount = hotspot_gross_amount + pppoe_gross_amount
      AND commission_amount = hotspot_commission_amount + pppoe_commission_amount
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_platform_invoice_receipt_match()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'collected'
     AND (
       OLD.status IS DISTINCT FROM 'collected'
       OR NEW.mpesa_receipt IS DISTINCT FROM OLD.mpesa_receipt
       OR NEW.tenant_mpesa_receipt IS DISTINCT FROM OLD.tenant_mpesa_receipt
     )
  THEN
    IF NEW.tenant_mpesa_receipt IS NULL
       OR NEW.mpesa_receipt IS NULL
       OR NEW.tenant_mpesa_receipt !~ '^[A-Z0-9]{6,40}$'
       OR NEW.mpesa_receipt IS DISTINCT FROM NEW.tenant_mpesa_receipt
    THEN
      RAISE EXCEPTION 'Payment receipt must exactly match the tenant-submitted code'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.collected_at := COALESCE(NEW.collected_at, now());
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS platform_invoice_receipt_match ON public.platform_commissions;
CREATE TRIGGER platform_invoice_receipt_match
  BEFORE UPDATE OF status, mpesa_receipt, tenant_mpesa_receipt
  ON public.platform_commissions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_platform_invoice_receipt_match();

CREATE OR REPLACE FUNCTION public.generate_monthly_platform_commission_invoices(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_month timestamp;
  v_month timestamp;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_tenant record;
  v_existing public.platform_commissions%ROWTYPE;
  v_tracking_start timestamptz;
  v_invoice_number text;
  v_count integer := 0;
BEGIN
  v_local_month := date_trunc('month', p_now AT TIME ZONE 'Africa/Nairobi');
  SELECT commission_tracking_starts_at
  INTO v_tracking_start
  FROM public.platform_billing_config
  WHERE id = 1;

  FOR v_month IN
    SELECT DISTINCT date_trunc('month', p.created_at AT TIME ZONE 'Africa/Nairobi')
    FROM public.payments p
    JOIN public.packages pkg
      ON pkg.id = p.package_id
     AND pkg.tenant_id = p.tenant_id
     AND pkg.tenant_id = p.tenant_id
    WHERE p.status = 'success'
      AND pkg.kind IN ('hotspot', 'voucher', 'pppoe')
      AND p.created_at >= v_tracking_start
      AND p.created_at < (v_local_month AT TIME ZONE 'Africa/Nairobi')
    ORDER BY 1
  LOOP
    v_period_start := v_month AT TIME ZONE 'Africa/Nairobi';
    v_period_end := (v_month + interval '1 month') AT TIME ZONE 'Africa/Nairobi';

    FOR v_tenant IN
      SELECT
        t.id,
        t.slug,
        COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher')), 0)
          ::numeric(14,2) AS hotspot_gross_amount,
        COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0)
          ::numeric(14,2) AS pppoe_gross_amount,
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher')), 0) * 0.02, 2)
          ::numeric(14,2) AS hotspot_commission_amount,
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0) * 0.01, 2)
          ::numeric(14,2) AS pppoe_commission_amount
      FROM public.payments p
      JOIN public.packages pkg
        ON pkg.id = p.package_id
       AND pkg.tenant_id = p.tenant_id
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.status = 'success'
        AND pkg.kind IN ('hotspot', 'voucher', 'pppoe')
        AND p.created_at >= GREATEST(v_period_start, v_tracking_start)
        AND p.created_at < v_period_end
      GROUP BY t.id, t.slug
      HAVING round(
        COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher')), 0) * 0.02,
        2
      ) + round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0) * 0.01, 2) > 0
    LOOP
      v_invoice_number :=
        'INV-' || to_char(v_month, 'YYYYMM') || '-' ||
        upper(replace(v_tenant.id::text, '-', ''));

      SELECT pc.*
      INTO v_existing
      FROM public.platform_commissions pc
      WHERE pc.tenant_id = v_tenant.id
        AND pc.period_start < v_period_end
        AND pc.period_end >= v_period_start
      ORDER BY (pc.status = 'collected') DESC, pc.created_at
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        IF v_existing.status <> 'collected' AND v_existing.invoice_number IS NULL THEN
          UPDATE public.platform_commissions
          SET period_start = v_period_start,
              period_end = v_period_end,
              hotspot_gross_amount = v_tenant.hotspot_gross_amount,
              pppoe_gross_amount = v_tenant.pppoe_gross_amount,
              hotspot_commission_amount = v_tenant.hotspot_commission_amount,
              pppoe_commission_amount = v_tenant.pppoe_commission_amount,
              hotspot_commission_rate_pct = 2,
              pppoe_commission_rate_pct = 1,
              gross_amount = v_tenant.hotspot_gross_amount + v_tenant.pppoe_gross_amount,
              commission_amount =
                v_tenant.hotspot_commission_amount + v_tenant.pppoe_commission_amount,
              commission_rate_pct = NULL,
              invoice_number = COALESCE(invoice_number, v_invoice_number),
              issued_at = COALESCE(issued_at, p_now),
              due_at = COALESCE(due_at, p_now + interval '72 hours'),
              email_status = CASE
                WHEN invoice_number IS NULL THEN 'pending'
                ELSE email_status
              END
          WHERE id = v_existing.id;
          v_count := v_count + 1;
        END IF;
      ELSE
        INSERT INTO public.platform_commissions (
          tenant_id,
          period_start,
          period_end,
          gross_amount,
          commission_amount,
          commission_rate_pct,
          hotspot_gross_amount,
          pppoe_gross_amount,
          hotspot_commission_amount,
          pppoe_commission_amount,
          hotspot_commission_rate_pct,
          pppoe_commission_rate_pct,
          invoice_number,
          issued_at,
          due_at,
          status,
          email_status
        )
        VALUES (
          v_tenant.id,
          v_period_start,
          v_period_end,
          v_tenant.hotspot_gross_amount + v_tenant.pppoe_gross_amount,
          v_tenant.hotspot_commission_amount + v_tenant.pppoe_commission_amount,
          NULL,
          v_tenant.hotspot_gross_amount,
          v_tenant.pppoe_gross_amount,
          v_tenant.hotspot_commission_amount,
          v_tenant.pppoe_commission_amount,
          2,
          1,
          v_invoice_number,
          p_now,
          p_now + interval '72 hours',
          'pending',
          'pending'
        )
        ON CONFLICT (tenant_id, period_start, period_end) DO NOTHING;
        IF FOUND THEN
          v_count := v_count + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_platform_invoice_receipt_match()
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.enforce_platform_invoice_receipt_match() TO service_role;
-- END MIGRATION: supabase/migrations/20261117000000_tiered_platform_commissions.sql

-- BEGIN MIGRATION: supabase/migrations/20261118000000_isp_self_service_onboarding.sql
CREATE OR REPLACE FUNCTION public.provision_isp_tenant(
  p_business_name text,
  p_phone text,
  p_full_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_email text;
  v_name text := trim(COALESCE(p_business_name, ''));
  v_phone text := trim(COALESCE(p_phone, ''));
  v_full_name text := trim(COALESCE(p_full_name, ''));
  v_slug_base text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to create your ISP workspace' USING ERRCODE = '42501';
  END IF;
  IF length(v_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Business / ISP name must be between 2 and 120 characters'
      USING ERRCODE = '22023';
  END IF;
  IF v_phone !~ '^\+?[0-9][0-9 ()-]{6,19}$' THEN
    RAISE EXCEPTION 'Enter a valid contact phone number' USING ERRCODE = '22023';
  END IF;
  IF length(v_full_name) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'Contact name must be between 2 and 100 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.tenant_id
  INTO v_tenant_id
  FROM public.profiles p
  WHERE p.id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your account profile is not ready yet' USING ERRCODE = 'P0002';
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = v_user_id
        AND ur.tenant_id = v_tenant_id
        AND ur.role = 'tenant_admin'
    ) THEN
      RETURN v_tenant_id;
    END IF;
    RAISE EXCEPTION 'Your account is already linked to a workspace' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_user_id) THEN
    RAISE EXCEPTION 'Your account already has platform access' USING ERRCODE = '23505';
  END IF;

  SELECT u.email
  INTO v_email
  FROM auth.users u
  WHERE u.id = v_user_id;

  v_slug_base := trim(both '-' FROM regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_slug_base := left(COALESCE(NULLIF(v_slug_base, ''), 'isp'), 50);
  v_tenant_id := gen_random_uuid();

  INSERT INTO public.tenants (id, name, slug, support_email, support_phone)
  VALUES (
    v_tenant_id,
    v_name,
    v_slug_base || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8),
    v_email,
    v_phone
  );

  UPDATE public.profiles
  SET tenant_id = v_tenant_id,
      full_name = v_full_name,
      phone = v_phone
  WHERE id = v_user_id;

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (v_user_id, 'tenant_admin', v_tenant_id);

  RETURN v_tenant_id;
END
$$;

REVOKE ALL ON FUNCTION public.provision_isp_tenant(text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_isp_tenant(text, text, text)
  TO authenticated;

DROP FUNCTION IF EXISTS public.update_tenant_member_roles(uuid, public.app_role[]);

CREATE OR REPLACE FUNCTION public.update_tenant_member_roles(
  p_actor_id uuid,
  p_user_id uuid,
  p_roles public.app_role[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_has_admin boolean;
  v_has_other_admin boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Tenant roles must be managed through the authenticated server action'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage tenant roles' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = p_actor_id THEN
    RAISE EXCEPTION 'You cannot change your own roles' USING ERRCODE = '42501';
  END IF;
  IF p_roles IS NULL OR cardinality(p_roles) = 0 OR array_position(p_roles, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Select at least one role' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_roles) AS requested(role)
    WHERE requested.role NOT IN ('tenant_admin', 'technician', 'billing_agent', 'support_staff')
  ) THEN
    RAISE EXCEPTION 'One or more selected roles are not tenant roles' USING ERRCODE = '22023';
  END IF;

  SELECT ur.tenant_id
  INTO v_tenant_id
  FROM public.user_roles ur
  WHERE ur.user_id = p_actor_id
    AND ur.role = 'tenant_admin'
    AND ur.tenant_id IS NOT NULL
  ORDER BY ur.tenant_id
  LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Only tenant admins can manage team roles' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id = v_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id AND ur.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Team member not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.tenant_id = v_tenant_id
      AND ur.role = 'tenant_admin'
  ) INTO v_has_admin;
  IF v_has_admin AND NOT ('tenant_admin' = ANY(p_roles)) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.tenant_id = v_tenant_id
        AND ur.role = 'tenant_admin'
        AND ur.user_id <> p_user_id
    ) INTO v_has_other_admin;
    IF NOT v_has_other_admin THEN
      RAISE EXCEPTION 'A tenant must keep at least one admin' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  DELETE FROM public.user_roles ur
  WHERE ur.user_id = p_user_id
    AND ur.tenant_id = v_tenant_id;

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  SELECT p_user_id, requested.role, v_tenant_id
  FROM (SELECT DISTINCT unnest(p_roles) AS role) AS requested;
END
$$;

REVOKE ALL ON FUNCTION public.update_tenant_member_roles(uuid, uuid, public.app_role[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_tenant_member_roles(uuid, uuid, public.app_role[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.remove_tenant_member(
  p_actor_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_admin boolean;
  v_has_other_admin boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Team members must be removed through the authenticated server action'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_user_id = p_actor_id THEN
    RAISE EXCEPTION 'You cannot remove yourself' USING ERRCODE = '42501';
  END IF;

  SELECT ur.tenant_id
  INTO v_tenant_id
  FROM public.user_roles ur
  WHERE ur.user_id = p_actor_id
    AND ur.role = 'tenant_admin'
    AND ur.tenant_id IS NOT NULL
  ORDER BY ur.tenant_id
  LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Only tenant admins can manage the team' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id = v_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id AND ur.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Team member not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.tenant_id = v_tenant_id
      AND ur.role = 'tenant_admin'
  ) INTO v_is_admin;
  IF v_is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.tenant_id = v_tenant_id
        AND ur.role = 'tenant_admin'
        AND ur.user_id <> p_user_id
    ) INTO v_has_other_admin;
    IF NOT v_has_other_admin THEN
      RAISE EXCEPTION 'A tenant must keep at least one admin' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  DELETE FROM public.user_roles ur
  WHERE ur.user_id = p_user_id AND ur.tenant_id = v_tenant_id;
  UPDATE public.profiles
  SET tenant_id = NULL
  WHERE id = p_user_id AND tenant_id = v_tenant_id;
END
$$;

REVOKE ALL ON FUNCTION public.remove_tenant_member(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_tenant_member(uuid, uuid)
  TO service_role;
-- END MIGRATION: supabase/migrations/20261118000000_isp_self_service_onboarding.sql

-- BEGIN MIGRATION: supabase/migrations/20261119000000_platform_c2b_invoice_matching.sql
ALTER TABLE public.platform_mpesa_config
  ADD COLUMN IF NOT EXISTS c2b_callback_token text,
  ADD COLUMN IF NOT EXISTS c2b_registered_at timestamptz;

ALTER TABLE public.platform_commissions
  ADD COLUMN IF NOT EXISTS payment_reference text
    DEFAULT ('NG' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)));

UPDATE public.platform_commissions
SET payment_reference = 'NG' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
WHERE payment_reference IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS platform_commissions_payment_reference_key
  ON public.platform_commissions (payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.platform_mpesa_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text NOT NULL UNIQUE,
  shortcode text NOT NULL,
  bill_ref_number text,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  transaction_time timestamptz NOT NULL,
  first_name text,
  middle_name text,
  last_name text,
  commission_id uuid REFERENCES public.platform_commissions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'unmatched'
    CHECK (status IN ('matched', 'unmatched', 'amount_mismatch', 'invoice_already_paid')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_mpesa_transactions_created_at_idx
  ON public.platform_mpesa_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_mpesa_transactions_bill_ref_idx
  ON public.platform_mpesa_transactions (bill_ref_number, transaction_time DESC);

ALTER TABLE public.platform_mpesa_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_mpesa_transactions FROM PUBLIC, anon;
GRANT SELECT ON public.platform_mpesa_transactions TO authenticated;
GRANT ALL ON public.platform_mpesa_transactions TO service_role;

DROP POLICY IF EXISTS "platform mpesa transactions super read"
  ON public.platform_mpesa_transactions;
CREATE POLICY "platform mpesa transactions super read"
  ON public.platform_mpesa_transactions
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.record_platform_c2b_transaction(
  p_transaction_id text,
  p_shortcode text,
  p_bill_ref_number text,
  p_amount numeric,
  p_transaction_time timestamptz,
  p_first_name text DEFAULT NULL,
  p_middle_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_id uuid;
  v_commission public.platform_commissions%ROWTYPE;
  v_status text;
BEGIN
  INSERT INTO public.platform_mpesa_transactions (
    transaction_id,
    shortcode,
    bill_ref_number,
    amount,
    transaction_time,
    first_name,
    middle_name,
    last_name
  )
  VALUES (
    p_transaction_id,
    p_shortcode,
    NULLIF(btrim(p_bill_ref_number), ''),
    p_amount,
    p_transaction_time,
    NULLIF(left(p_first_name, 100), ''),
    NULLIF(left(p_middle_name, 100), ''),
    NULLIF(left(p_last_name, 100), '')
  )
  ON CONFLICT (transaction_id) DO NOTHING
  RETURNING id INTO v_transaction_id;

  IF v_transaction_id IS NULL THEN
    RETURN 'duplicate';
  END IF;

  IF NULLIF(btrim(p_bill_ref_number), '') IS NULL THEN
    RETURN 'unmatched';
  END IF;

  SELECT pc.*
  INTO v_commission
  FROM public.platform_commissions pc
  WHERE pc.payment_reference = btrim(p_bill_ref_number)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'unmatched';
  END IF;

  IF v_commission.status = 'collected' THEN
    v_status := 'invoice_already_paid';
  ELSIF v_commission.commission_amount <> p_amount THEN
    v_status := 'amount_mismatch';
  ELSE
    UPDATE public.platform_commissions
    SET status = 'collected',
        mpesa_receipt = p_transaction_id,
        collected_at = p_transaction_time
    WHERE id = v_commission.id
      AND status = 'pending';

    IF FOUND THEN
      v_status := 'matched';
    ELSE
      v_status := 'invoice_already_paid';
    END IF;
  END IF;

  UPDATE public.platform_mpesa_transactions
  SET status = v_status,
      commission_id = CASE
        WHEN v_status IN ('matched', 'amount_mismatch', 'invoice_already_paid')
          THEN v_commission.id
        ELSE NULL
      END
  WHERE id = v_transaction_id;

  RETURN v_status;
END
$$;

REVOKE ALL ON FUNCTION public.record_platform_c2b_transaction(
  text, text, text, numeric, timestamptz, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_platform_c2b_transaction(
  text, text, text, numeric, timestamptz, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.reset_platform_c2b_registration_on_shortcode_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.shortcode IS DISTINCT FROM OLD.shortcode THEN
    NEW.c2b_registered_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS platform_c2b_shortcode_registration_reset
  ON public.platform_mpesa_config;
CREATE TRIGGER platform_c2b_shortcode_registration_reset
  BEFORE UPDATE OF shortcode ON public.platform_mpesa_config
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_platform_c2b_registration_on_shortcode_change();

REVOKE ALL ON FUNCTION public.reset_platform_c2b_registration_on_shortcode_change()
  FROM PUBLIC, anon, authenticated;
-- END MIGRATION: supabase/migrations/20261119000000_platform_c2b_invoice_matching.sql

-- BEGIN MIGRATION: supabase/migrations/20261120000000_platform_daraja_credentials.sql
CREATE TABLE IF NOT EXISTS public.platform_service_secrets (
  name text PRIMARY KEY CHECK (name IN (
    'APP_BASE_URL',
    'PLATFORM_MPESA_ENV',
    'PLATFORM_MPESA_CONSUMER_KEY',
    'PLATFORM_MPESA_CONSUMER_SECRET'
  )),
  ciphertext text NOT NULL,
  last4 text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.platform_service_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_service_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_service_secrets TO service_role;
-- END MIGRATION: supabase/migrations/20261120000000_platform_daraja_credentials.sql

-- BEGIN MIGRATION: supabase/migrations/20261121000000_platform_buygoods_stk.sql
ALTER TABLE public.platform_service_secrets
  DROP CONSTRAINT IF EXISTS platform_service_secrets_name_check;
ALTER TABLE public.platform_service_secrets
  ADD CONSTRAINT platform_service_secrets_name_check
  CHECK (name IN (
    'APP_BASE_URL',
    'PLATFORM_MPESA_ENV',
    'PLATFORM_MPESA_CONSUMER_KEY',
    'PLATFORM_MPESA_CONSUMER_SECRET',
    'PLATFORM_MPESA_MERCHANT_TYPE',
    'PLATFORM_MPESA_BUSINESS_SHORTCODE',
    'PLATFORM_MPESA_PASSKEY'
  ));

ALTER TABLE public.platform_mpesa_transactions
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'c2b';
ALTER TABLE public.platform_mpesa_transactions
  DROP CONSTRAINT IF EXISTS platform_mpesa_transactions_payment_method_check;
ALTER TABLE public.platform_mpesa_transactions
  ADD CONSTRAINT platform_mpesa_transactions_payment_method_check
  CHECK (payment_method IN ('c2b', 'stk'));

CREATE TABLE IF NOT EXISTS public.platform_stk_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.platform_commissions(id) ON DELETE CASCADE,
  checkout_request_id text UNIQUE,
  merchant_request_id text,
  phone text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_stk_payments_one_pending_per_invoice
  ON public.platform_stk_payments (invoice_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS platform_stk_payments_checkout_request_idx
  ON public.platform_stk_payments (checkout_request_id)
  WHERE checkout_request_id IS NOT NULL;

ALTER TABLE public.platform_stk_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_stk_payments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_stk_payments TO service_role;

CREATE OR REPLACE FUNCTION public.record_platform_stk_transaction(
  p_checkout_request_id text,
  p_transaction_id text,
  p_shortcode text,
  p_amount numeric,
  p_transaction_time timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.platform_stk_payments%ROWTYPE;
  v_commission public.platform_commissions%ROWTYPE;
  v_transaction_id uuid;
  v_status text;
BEGIN
  SELECT *
  INTO v_payment
  FROM public.platform_stk_payments
  WHERE checkout_request_id = p_checkout_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'unmatched';
  END IF;

  SELECT *
  INTO v_commission
  FROM public.platform_commissions
  WHERE id = v_payment.invoice_id
  FOR UPDATE;

  INSERT INTO public.platform_mpesa_transactions (
    transaction_id, shortcode, bill_ref_number, amount, transaction_time,
    commission_id, status, payment_method
  )
  VALUES (
    p_transaction_id,
    p_shortcode,
    v_commission.payment_reference,
    p_amount,
    p_transaction_time,
    v_commission.id,
    'unmatched',
    'stk'
  )
  ON CONFLICT (transaction_id) DO NOTHING
  RETURNING id INTO v_transaction_id;

  IF v_transaction_id IS NULL THEN
    RETURN 'duplicate';
  END IF;

  IF v_commission.status = 'collected' THEN
    v_status := 'invoice_already_paid';
  ELSIF v_commission.commission_amount <> p_amount THEN
    v_status := 'amount_mismatch';
  ELSE
    UPDATE public.platform_commissions
    SET status = 'collected',
        mpesa_receipt = p_transaction_id,
        tenant_mpesa_receipt = p_transaction_id,
        collected_at = p_transaction_time
    WHERE id = v_commission.id
      AND status = 'pending';
    IF FOUND THEN
      v_status := 'matched';
    ELSE
      v_status := 'invoice_already_paid';
    END IF;
  END IF;

  UPDATE public.platform_mpesa_transactions
  SET status = v_status
  WHERE id = v_transaction_id;

  UPDATE public.platform_stk_payments
  SET status = 'completed', updated_at = now()
  WHERE id = v_payment.id;

  RETURN v_status;
END
$$;

CREATE OR REPLACE FUNCTION public.record_platform_c2b_transaction(
  p_transaction_id text,
  p_shortcode text,
  p_bill_ref_number text,
  p_amount numeric,
  p_transaction_time timestamptz,
  p_first_name text DEFAULT NULL,
  p_middle_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_id uuid;
  v_commission public.platform_commissions%ROWTYPE;
  v_status text;
BEGIN
  INSERT INTO public.platform_mpesa_transactions (
    transaction_id, shortcode, bill_ref_number, amount, transaction_time,
    first_name, middle_name, last_name
  )
  VALUES (
    p_transaction_id,
    p_shortcode,
    NULLIF(btrim(p_bill_ref_number), ''),
    p_amount,
    p_transaction_time,
    NULLIF(left(p_first_name, 100), ''),
    NULLIF(left(p_middle_name, 100), ''),
    NULLIF(left(p_last_name, 100), '')
  )
  ON CONFLICT (transaction_id) DO NOTHING
  RETURNING id INTO v_transaction_id;

  IF v_transaction_id IS NULL THEN
    RETURN 'duplicate';
  END IF;

  IF NULLIF(btrim(p_bill_ref_number), '') IS NULL THEN
    RETURN 'unmatched';
  END IF;

  SELECT pc.*
  INTO v_commission
  FROM public.platform_commissions pc
  WHERE pc.payment_reference = btrim(p_bill_ref_number)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'unmatched';
  END IF;

  IF v_commission.status = 'collected' THEN
    v_status := 'invoice_already_paid';
  ELSIF v_commission.commission_amount <> p_amount THEN
    v_status := 'amount_mismatch';
  ELSE
    UPDATE public.platform_commissions
    SET status = 'collected',
        mpesa_receipt = p_transaction_id,
        tenant_mpesa_receipt = p_transaction_id,
        collected_at = p_transaction_time
    WHERE id = v_commission.id
      AND status = 'pending';

    IF FOUND THEN
      v_status := 'matched';
    ELSE
      v_status := 'invoice_already_paid';
    END IF;
  END IF;

  UPDATE public.platform_mpesa_transactions
  SET status = v_status,
      commission_id = CASE
        WHEN v_status IN ('matched', 'amount_mismatch', 'invoice_already_paid')
          THEN v_commission.id
        ELSE NULL
      END
  WHERE id = v_transaction_id;

  RETURN v_status;
END
$$;

REVOKE ALL ON FUNCTION public.record_platform_stk_transaction(
  text, text, text, numeric, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_platform_stk_transaction(
  text, text, text, numeric, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_platform_stk_payment(p_checkout_request_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.platform_stk_payments
  SET status = 'failed', updated_at = now()
  WHERE checkout_request_id = p_checkout_request_id
    AND status = 'pending';
  RETURN FOUND;
END
$$;

REVOKE ALL ON FUNCTION public.fail_platform_stk_payment(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_platform_stk_payment(text) TO service_role;

CREATE OR REPLACE FUNCTION public.generate_monthly_platform_commission_invoices(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_month timestamp;
  v_month timestamp;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_tenant record;
  v_existing public.platform_commissions%ROWTYPE;
  v_tracking_start timestamptz;
  v_invoice_number text;
  v_count integer := 0;
BEGIN
  v_local_month := date_trunc('month', p_now AT TIME ZONE 'Africa/Nairobi');
  SELECT commission_tracking_starts_at
  INTO v_tracking_start
  FROM public.platform_billing_config
  WHERE id = 1;

  FOR v_month IN
    SELECT DISTINCT date_trunc('month', p.created_at AT TIME ZONE 'Africa/Nairobi')
    FROM public.payments p
    JOIN public.packages pkg
      ON pkg.id = p.package_id
     AND pkg.tenant_id = p.tenant_id
    WHERE p.status = 'success'
      AND pkg.kind IN ('hotspot', 'voucher', 'pppoe')
      AND p.created_at >= v_tracking_start
      AND p.created_at < (v_local_month AT TIME ZONE 'Africa/Nairobi')
    ORDER BY 1
  LOOP
    v_period_start := v_month AT TIME ZONE 'Africa/Nairobi';
    v_period_end := (v_month + interval '1 month') AT TIME ZONE 'Africa/Nairobi';

    FOR v_tenant IN
      SELECT
        t.id,
        t.slug,
        COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher')), 0)
          ::numeric(14,2) AS hotspot_gross_amount,
        COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0)
          ::numeric(14,2) AS pppoe_gross_amount,
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher')), 0) * 0.02, 2)
          ::numeric(14,2) AS hotspot_commission_amount,
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0) * 0.01, 2)
          ::numeric(14,2) AS pppoe_commission_amount
      FROM public.payments p
      JOIN public.packages pkg
        ON pkg.id = p.package_id
       AND pkg.tenant_id = p.tenant_id
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.status = 'success'
        AND pkg.kind IN ('hotspot', 'voucher', 'pppoe')
        AND p.created_at >= GREATEST(v_period_start, v_tracking_start)
        AND p.created_at < v_period_end
      GROUP BY t.id, t.slug
      HAVING round(
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher')), 0) * 0.02, 2)
        + round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0) * 0.01, 2),
        0
      ) > 0
    LOOP
      v_invoice_number :=
        'INV-' || to_char(v_month, 'YYYYMM') || '-' ||
        upper(replace(v_tenant.id::text, '-', ''));

      SELECT pc.*
      INTO v_existing
      FROM public.platform_commissions pc
      WHERE pc.tenant_id = v_tenant.id
        AND pc.period_start < v_period_end
        AND pc.period_end >= v_period_start
      ORDER BY (pc.status = 'collected') DESC, pc.created_at
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        IF v_existing.status <> 'collected' AND v_existing.invoice_number IS NULL THEN
          UPDATE public.platform_commissions
          SET period_start = v_period_start,
              period_end = v_period_end,
              hotspot_gross_amount = v_tenant.hotspot_gross_amount,
              pppoe_gross_amount = v_tenant.pppoe_gross_amount,
              hotspot_commission_amount = v_tenant.hotspot_commission_amount,
              pppoe_commission_amount = v_tenant.pppoe_commission_amount,
              hotspot_commission_rate_pct = 2,
              pppoe_commission_rate_pct = 1,
              gross_amount = v_tenant.hotspot_gross_amount + v_tenant.pppoe_gross_amount,
              commission_amount = round(
                v_tenant.hotspot_commission_amount + v_tenant.pppoe_commission_amount, 0
              ),
              commission_rate_pct = NULL,
              invoice_number = COALESCE(invoice_number, v_invoice_number),
              issued_at = COALESCE(issued_at, p_now),
              due_at = COALESCE(due_at, p_now + interval '72 hours'),
              email_status = CASE
                WHEN invoice_number IS NULL THEN 'pending'
                ELSE email_status
              END
          WHERE id = v_existing.id;
          v_count := v_count + 1;
        END IF;
      ELSE
        INSERT INTO public.platform_commissions (
          tenant_id, period_start, period_end, gross_amount, commission_amount,
          commission_rate_pct, hotspot_gross_amount, pppoe_gross_amount,
          hotspot_commission_amount, pppoe_commission_amount,
          hotspot_commission_rate_pct, pppoe_commission_rate_pct,
          invoice_number, issued_at, due_at, status, email_status
        )
        VALUES (
          v_tenant.id, v_period_start, v_period_end,
          v_tenant.hotspot_gross_amount + v_tenant.pppoe_gross_amount,
          round(v_tenant.hotspot_commission_amount + v_tenant.pppoe_commission_amount, 0),
          NULL, v_tenant.hotspot_gross_amount, v_tenant.pppoe_gross_amount,
          v_tenant.hotspot_commission_amount, v_tenant.pppoe_commission_amount, 2, 1,
          v_invoice_number, p_now, p_now + interval '72 hours', 'pending', 'pending'
        )
        ON CONFLICT (tenant_id, period_start, period_end) DO NOTHING;
        IF FOUND THEN
          v_count := v_count + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END
$$;

ALTER TABLE public.platform_commissions
  DROP CONSTRAINT IF EXISTS platform_commissions_tiered_amounts_check;
UPDATE public.platform_commissions
SET commission_amount = round(commission_amount, 0),
    email_status = CASE
      WHEN invoice_number IS NOT NULL THEN 'pending'
      ELSE email_status
    END,
    email_error = CASE
      WHEN invoice_number IS NOT NULL THEN NULL
      ELSE email_error
    END
WHERE status = 'pending'
  AND commission_amount <> round(commission_amount, 0);

ALTER TABLE public.platform_commissions
  ADD CONSTRAINT platform_commissions_tiered_amounts_check
  CHECK (
    (
      hotspot_gross_amount IS NULL
      AND pppoe_gross_amount IS NULL
      AND hotspot_commission_amount IS NULL
      AND pppoe_commission_amount IS NULL
      AND hotspot_commission_rate_pct IS NULL
      AND pppoe_commission_rate_pct IS NULL
    )
    OR (
      hotspot_gross_amount IS NOT NULL
      AND pppoe_gross_amount IS NOT NULL
      AND hotspot_commission_amount IS NOT NULL
      AND pppoe_commission_amount IS NOT NULL
      AND hotspot_commission_rate_pct IS NOT NULL
      AND pppoe_commission_rate_pct IS NOT NULL
      AND hotspot_commission_rate_pct = 2
      AND pppoe_commission_rate_pct = 1
      AND hotspot_gross_amount >= 0
      AND pppoe_gross_amount >= 0
      AND hotspot_commission_amount >= 0
      AND pppoe_commission_amount >= 0
      AND hotspot_commission_amount =
        round(hotspot_gross_amount * hotspot_commission_rate_pct / 100, 2)
      AND pppoe_commission_amount =
        round(pppoe_gross_amount * pppoe_commission_rate_pct / 100, 2)
      AND gross_amount = hotspot_gross_amount + pppoe_gross_amount
      AND (
        commission_amount = round(hotspot_commission_amount + pppoe_commission_amount, 0)
        OR (
          status = 'collected'
          AND commission_amount = hotspot_commission_amount + pppoe_commission_amount
        )
      )
    )
  );
-- END MIGRATION: supabase/migrations/20261121000000_platform_buygoods_stk.sql

-- BEGIN MIGRATION: supabase/migrations/20261122000000_customer_messaging_maintenance.sql
CREATE TABLE IF NOT EXISTS public.customer_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (customer_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS customer_announcements_active_window_idx
  ON public.customer_announcements (starts_at, ends_at)
  WHERE active;
CREATE INDEX IF NOT EXISTS customer_announcements_tenant_idx
  ON public.customer_announcements (tenant_id, created_at DESC)
  WHERE active;
CREATE INDEX IF NOT EXISTS customer_announcements_customer_idx
  ON public.customer_announcements (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_announcement_reads (
  announcement_id uuid NOT NULL REFERENCES public.customer_announcements(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, customer_id)
);

CREATE TABLE IF NOT EXISTS public.service_maintenance_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid REFERENCES public.routers(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  mode text NOT NULL CHECK (mode IN ('notice', 'block_new', 'block_all')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (router_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS service_maintenance_active_window_idx
  ON public.service_maintenance_windows (starts_at, ends_at)
  WHERE active;
CREATE INDEX IF NOT EXISTS service_maintenance_scope_idx
  ON public.service_maintenance_windows (tenant_id, router_id)
  WHERE active;

CREATE OR REPLACE FUNCTION public.validate_communication_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_tenant uuid;
  v_router_tenant uuid;
BEGIN
  IF TG_TABLE_NAME = 'customer_announcements' THEN
    IF NEW.customer_id IS NOT NULL THEN
      SELECT tenant_id INTO v_customer_tenant
      FROM public.customers
      WHERE id = NEW.customer_id;
      IF NOT FOUND OR NEW.tenant_id IS DISTINCT FROM v_customer_tenant THEN
        RAISE EXCEPTION 'Announcement customer must belong to its tenant';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'service_maintenance_windows' THEN
    IF NEW.router_id IS NOT NULL THEN
      SELECT tenant_id INTO v_router_tenant
      FROM public.routers
      WHERE id = NEW.router_id;
      IF NOT FOUND OR NEW.tenant_id IS DISTINCT FROM v_router_tenant THEN
        RAISE EXCEPTION 'Maintenance site must belong to its tenant';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS validate_customer_announcement_scope ON public.customer_announcements;
CREATE TRIGGER validate_customer_announcement_scope
  BEFORE INSERT OR UPDATE OF tenant_id, customer_id
  ON public.customer_announcements
  FOR EACH ROW EXECUTE FUNCTION public.validate_communication_scope();

DROP TRIGGER IF EXISTS validate_service_maintenance_scope ON public.service_maintenance_windows;
CREATE TRIGGER validate_service_maintenance_scope
  BEFORE INSERT OR UPDATE OF tenant_id, router_id
  ON public.service_maintenance_windows
  FOR EACH ROW EXECUTE FUNCTION public.validate_communication_scope();
REVOKE ALL ON FUNCTION public.validate_communication_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_communication_scope() TO service_role;

ALTER TABLE public.customer_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_maintenance_windows ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.customer_announcements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.customer_announcement_reads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.service_maintenance_windows FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_announcements TO service_role;
GRANT ALL ON public.customer_announcement_reads TO service_role;
GRANT ALL ON public.service_maintenance_windows TO service_role;
-- END MIGRATION: supabase/migrations/20261122000000_customer_messaging_maintenance.sql

-- BEGIN MIGRATION: supabase/migrations/20261123000000_phone_tv_package_commissions.sql
COMMENT ON COLUMN public.packages.kind IS 'hotspot|pppoe|voucher|hotspot_tv';

CREATE OR REPLACE FUNCTION public.generate_monthly_platform_commission_invoices(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_month timestamp;
  v_month timestamp;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_tenant record;
  v_existing public.platform_commissions%ROWTYPE;
  v_tracking_start timestamptz;
  v_invoice_number text;
  v_count integer := 0;
BEGIN
  v_local_month := date_trunc('month', p_now AT TIME ZONE 'Africa/Nairobi');
  SELECT commission_tracking_starts_at
  INTO v_tracking_start
  FROM public.platform_billing_config
  WHERE id = 1;

  FOR v_month IN
    SELECT DISTINCT date_trunc('month', p.created_at AT TIME ZONE 'Africa/Nairobi')
    FROM public.payments p
    JOIN public.packages pkg
      ON pkg.id = p.package_id
     AND pkg.tenant_id = p.tenant_id
    WHERE p.status = 'success'
      AND pkg.kind IN ('hotspot', 'voucher', 'hotspot_tv', 'pppoe')
      AND p.created_at >= v_tracking_start
      AND p.created_at < (v_local_month AT TIME ZONE 'Africa/Nairobi')
    ORDER BY 1
  LOOP
    v_period_start := v_month AT TIME ZONE 'Africa/Nairobi';
    v_period_end := (v_month + interval '1 month') AT TIME ZONE 'Africa/Nairobi';

    FOR v_tenant IN
      SELECT
        t.id,
        t.slug,
        COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher', 'hotspot_tv')), 0)
          ::numeric(14,2) AS hotspot_gross_amount,
        COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0)
          ::numeric(14,2) AS pppoe_gross_amount,
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher', 'hotspot_tv')), 0) * 0.02, 2)
          ::numeric(14,2) AS hotspot_commission_amount,
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0) * 0.01, 2)
          ::numeric(14,2) AS pppoe_commission_amount
      FROM public.payments p
      JOIN public.packages pkg
        ON pkg.id = p.package_id
       AND pkg.tenant_id = p.tenant_id
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.status = 'success'
        AND pkg.kind IN ('hotspot', 'voucher', 'hotspot_tv', 'pppoe')
        AND p.created_at >= GREATEST(v_period_start, v_tracking_start)
        AND p.created_at < v_period_end
      GROUP BY t.id, t.slug
      HAVING round(
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher', 'hotspot_tv')), 0) * 0.02, 2)
        + round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0) * 0.01, 2),
        0
      ) > 0
    LOOP
      v_invoice_number :=
        'INV-' || to_char(v_month, 'YYYYMM') || '-' ||
        upper(replace(v_tenant.id::text, '-', ''));

      SELECT pc.*
      INTO v_existing
      FROM public.platform_commissions pc
      WHERE pc.tenant_id = v_tenant.id
        AND pc.period_start < v_period_end
        AND pc.period_end >= v_period_start
      ORDER BY (pc.status = 'collected') DESC, pc.created_at
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        IF v_existing.status <> 'collected' AND v_existing.invoice_number IS NULL THEN
          UPDATE public.platform_commissions
          SET period_start = v_period_start,
              period_end = v_period_end,
              hotspot_gross_amount = v_tenant.hotspot_gross_amount,
              pppoe_gross_amount = v_tenant.pppoe_gross_amount,
              hotspot_commission_amount = v_tenant.hotspot_commission_amount,
              pppoe_commission_amount = v_tenant.pppoe_commission_amount,
              hotspot_commission_rate_pct = 2,
              pppoe_commission_rate_pct = 1,
              gross_amount = v_tenant.hotspot_gross_amount + v_tenant.pppoe_gross_amount,
              commission_amount = round(
                v_tenant.hotspot_commission_amount + v_tenant.pppoe_commission_amount, 0
              ),
              commission_rate_pct = NULL,
              invoice_number = COALESCE(invoice_number, v_invoice_number),
              issued_at = COALESCE(issued_at, p_now),
              due_at = COALESCE(due_at, p_now + interval '72 hours'),
              email_status = CASE
                WHEN invoice_number IS NULL THEN 'pending'
                ELSE email_status
              END
          WHERE id = v_existing.id;
          v_count := v_count + 1;
        END IF;
      ELSE
        INSERT INTO public.platform_commissions (
          tenant_id, period_start, period_end, gross_amount, commission_amount,
          commission_rate_pct, hotspot_gross_amount, pppoe_gross_amount,
          hotspot_commission_amount, pppoe_commission_amount,
          hotspot_commission_rate_pct, pppoe_commission_rate_pct,
          invoice_number, issued_at, due_at, status, email_status
        )
        VALUES (
          v_tenant.id, v_period_start, v_period_end,
          v_tenant.hotspot_gross_amount + v_tenant.pppoe_gross_amount,
          round(v_tenant.hotspot_commission_amount + v_tenant.pppoe_commission_amount, 0),
          NULL, v_tenant.hotspot_gross_amount, v_tenant.pppoe_gross_amount,
          v_tenant.hotspot_commission_amount, v_tenant.pppoe_commission_amount, 2, 1,
          v_invoice_number, p_now, p_now + interval '72 hours', 'pending', 'pending'
        )
        ON CONFLICT (tenant_id, period_start, period_end) DO NOTHING;
        IF FOUND THEN
          v_count := v_count + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END
$$;
-- END MIGRATION: supabase/migrations/20261123000000_phone_tv_package_commissions.sql

-- BEGIN MIGRATION: supabase/migrations/20261124000000_team_profile_names.sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;
-- END MIGRATION: supabase/migrations/20261124000000_team_profile_names.sql

-- BEGIN MIGRATION: supabase/migrations/20261125000000_omada_integrations.sql
CREATE TABLE IF NOT EXISTS public.omada_integrations (
  router_id uuid PRIMARY KEY REFERENCES public.routers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  controller_host text NOT NULL,
  controller_port integer NOT NULL CHECK (controller_port IN (433, 443, 8043)),
  controller_id text NOT NULL,
  controller_version text NOT NULL,
  site_name text NOT NULL,
  operator_username text NOT NULL,
  operator_password_ciphertext text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omada_integrations_version_supported
    CHECK (controller_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);

ALTER TABLE public.omada_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.omada_integrations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.omada_integrations TO service_role;
-- END MIGRATION: supabase/migrations/20261125000000_omada_integrations.sql

-- BEGIN MIGRATION: supabase/migrations/20261126000000_omada_authorization_jobs.sql
CREATE TABLE IF NOT EXISTS public.omada_authorization_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  context_kind text NOT NULL CHECK (context_kind IN ('eap', 'gateway')),
  client_mac text NOT NULL CHECK (client_mac ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  ap_mac text,
  gateway_mac text,
  ssid_name text,
  radio_id text CHECK (radio_id IN ('0', '1')),
  vlan_id text,
  site_name text NOT NULL,
  redirect_url text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'authorized', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  authorized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omada_authorization_context_shape CHECK (
    (context_kind = 'eap' AND ap_mac IS NOT NULL AND ssid_name IS NOT NULL AND radio_id IS NOT NULL
      AND gateway_mac IS NULL AND vlan_id IS NULL)
    OR
    (context_kind = 'gateway' AND gateway_mac IS NOT NULL AND vlan_id IS NOT NULL
      AND ap_mac IS NULL AND ssid_name IS NULL AND radio_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS omada_authorization_jobs_retry_idx
  ON public.omada_authorization_jobs (status, next_attempt_at);

ALTER TABLE public.omada_authorization_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.omada_authorization_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.omada_authorization_jobs TO service_role;
-- END MIGRATION: supabase/migrations/20261126000000_omada_authorization_jobs.sql

-- BEGIN MIGRATION: supabase/migrations/20261127000000_live_client_bandwidth.sql
ALTER TABLE public.router_devices
  ADD COLUMN IF NOT EXISTS traffic_bytes_in bigint,
  ADD COLUMN IF NOT EXISTS traffic_bytes_out bigint,
  ADD COLUMN IF NOT EXISTS download_bps bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_bps bigint NOT NULL DEFAULT 0;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS download_bps bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_bps bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.guard_pppoe_usage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.data_used_bytes := 0;
      NEW.usage_session_id := NULL;
      NEW.usage_bytes_in := 0;
      NEW.usage_bytes_out := 0;
      NEW.download_bps := 0;
      NEW.upload_bps := 0;
    ELSIF NEW.data_used_bytes IS DISTINCT FROM OLD.data_used_bytes
       OR NEW.usage_session_id IS DISTINCT FROM OLD.usage_session_id
       OR NEW.usage_bytes_in IS DISTINCT FROM OLD.usage_bytes_in
       OR NEW.usage_bytes_out IS DISTINCT FROM OLD.usage_bytes_out
       OR NEW.download_bps IS DISTINCT FROM OLD.download_bps
       OR NEW.upload_bps IS DISTINCT FROM OLD.upload_bps THEN
      RAISE EXCEPTION 'Usage and bandwidth are reported by the router and cannot be edited'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pppoe_sessions(
  p_router_id uuid,
  p_tenant_id uuid,
  p_sessions jsonb
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH incoming AS (
    SELECT
      x.username,
      x.mac,
      x.ip,
      x.session_id,
      CASE
        WHEN x.session_id ~ '^[A-Za-z0-9._:-]{1,128}$' THEN
          CASE WHEN x.bytes_in ~ '^[0-9]{1,19}$' THEN
            CASE WHEN x.bytes_in::numeric <= 9223372036854775807 THEN x.bytes_in::bigint END
          END
      END AS bytes_in,
      CASE
        WHEN x.session_id ~ '^[A-Za-z0-9._:-]{1,128}$' THEN
          CASE WHEN x.bytes_out ~ '^[0-9]{1,19}$' THEN
            CASE WHEN x.bytes_out::numeric <= 9223372036854775807 THEN x.bytes_out::bigint END
          END
      END AS bytes_out
    FROM jsonb_to_recordset(p_sessions) AS x(
      username text,
      mac text,
      ip text,
      session_id text,
      bytes_in text,
      bytes_out text
    )
    LIMIT 500
  ), updated AS (
    UPDATE public.customers c
       SET last_mac = s.mac,
           last_ip = s.ip,
           last_seen_at = now(),
           last_router_id = p_router_id,
           data_used_bytes = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.data_used_bytes
             WHEN c.usage_session_id = s.session_id THEN
               c.data_used_bytes
               + greatest(s.bytes_in - c.usage_bytes_in, 0)
               + greatest(s.bytes_out - c.usage_bytes_out, 0)
             WHEN c.usage_session_id IS NULL THEN c.data_used_bytes
             ELSE c.data_used_bytes + s.bytes_in + s.bytes_out
           END,
           usage_session_id = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.usage_session_id
             ELSE s.session_id
           END,
           usage_bytes_in = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.usage_bytes_in
             WHEN c.usage_session_id = s.session_id THEN greatest(c.usage_bytes_in, s.bytes_in)
             ELSE s.bytes_in
           END,
           usage_bytes_out = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.usage_bytes_out
             WHEN c.usage_session_id = s.session_id THEN greatest(c.usage_bytes_out, s.bytes_out)
             ELSE s.bytes_out
           END,
           download_bps = CASE
             WHEN s.bytes_out IS NULL OR c.usage_session_id IS DISTINCT FROM s.session_id
               OR c.last_seen_at IS NULL OR now() - c.last_seen_at > interval '3 minutes' THEN 0
             ELSE LEAST(
               floor(greatest(s.bytes_out - c.usage_bytes_out, 0)::numeric * 1000
                 / greatest(extract(epoch FROM (now() - c.last_seen_at)) * 1000, 1000)),
               9223372036854775807
             )::bigint
           END,
           upload_bps = CASE
             WHEN s.bytes_in IS NULL OR c.usage_session_id IS DISTINCT FROM s.session_id
               OR c.last_seen_at IS NULL OR now() - c.last_seen_at > interval '3 minutes' THEN 0
             ELSE LEAST(
               floor(greatest(s.bytes_in - c.usage_bytes_in, 0)::numeric * 1000
                 / greatest(extract(epoch FROM (now() - c.last_seen_at)) * 1000, 1000)),
               9223372036854775807
             )::bigint
           END
      FROM incoming s
     WHERE c.tenant_id = p_tenant_id
       AND c.customer_type = 'pppoe'
       AND c.pppoe_username = s.username
       AND (c.router_id IS NULL OR c.router_id = p_router_id)
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated;
$$;

REVOKE ALL ON FUNCTION public.guard_pppoe_usage() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) TO service_role;
-- END MIGRATION: supabase/migrations/20261127000000_live_client_bandwidth.sql

-- BEGIN MIGRATION: supabase/migrations/20261128000000_tenant_customization.sql
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS ui_labels jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

GRANT UPDATE (ui_labels) ON public.tenants TO authenticated;
GRANT UPDATE (preferences) ON public.profiles TO authenticated;

CREATE TABLE IF NOT EXISTS public.tenant_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('hotspot', 'console')),
  domain text NOT NULL CHECK (
    domain = lower(domain)
    AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    AND domain !~ '^[0-9.]+$'
    AND length(domain) <= 253
  ),
  verification_token text NOT NULL DEFAULT ('netgrid-' || replace(gen_random_uuid()::text, '-', '')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_domains_domain_key
  ON public.tenant_domains (domain);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_domains_tenant_purpose_key
  ON public.tenant_domains (tenant_id, purpose);

CREATE OR REPLACE FUNCTION public.reset_tenant_domain_verification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.domain IS DISTINCT FROM OLD.domain THEN
    NEW.verified_at := NULL;
    NEW.verification_token := 'netgrid-' || replace(gen_random_uuid()::text, '-', '');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.reset_tenant_domain_verification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tenant_domains_reset_verification ON public.tenant_domains;
CREATE TRIGGER tenant_domains_reset_verification
  BEFORE UPDATE ON public.tenant_domains
  FOR EACH ROW EXECUTE FUNCTION public.reset_tenant_domain_verification();

ALTER TABLE public.tenant_domains ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON public.tenant_domains TO authenticated;
GRANT INSERT (tenant_id, purpose, domain) ON public.tenant_domains TO authenticated;
GRANT UPDATE (domain) ON public.tenant_domains TO authenticated;
GRANT ALL ON public.tenant_domains TO service_role;

DROP POLICY IF EXISTS "tenant domains admin select" ON public.tenant_domains;
CREATE POLICY "tenant domains admin select" ON public.tenant_domains
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  );

DROP POLICY IF EXISTS "tenant domains admin insert" ON public.tenant_domains;
CREATE POLICY "tenant domains admin insert" ON public.tenant_domains
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  );

DROP POLICY IF EXISTS "tenant domains admin update" ON public.tenant_domains;
CREATE POLICY "tenant domains admin update" ON public.tenant_domains
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  );

DROP POLICY IF EXISTS "tenant domains admin delete" ON public.tenant_domains;
CREATE POLICY "tenant domains admin delete" ON public.tenant_domains
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  );
-- END MIGRATION: supabase/migrations/20261128000000_tenant_customization.sql

-- BEGIN MIGRATION: supabase/migrations/20261129000000_payment_hotspot_device_binding.sql
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS bound_mac text;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_bound_mac_format_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_bound_mac_format_check
  CHECK (bound_mac IS NULL OR bound_mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$');

CREATE INDEX IF NOT EXISTS payments_bound_mac_idx
  ON public.payments (tenant_id, bound_mac)
  WHERE bound_mac IS NOT NULL;
-- END MIGRATION: supabase/migrations/20261129000000_payment_hotspot_device_binding.sql

-- BEGIN MIGRATION: supabase/migrations/20261130000000_restrict_free_pppoe_and_role_oracles.sql
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    _user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id
        AND role = _role
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    _user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id
        AND role = 'super_admin'
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(
  _user_id uuid,
  _tenant_id uuid,
  _roles public.app_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    _user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.tenant_id = _tenant_id
        AND ur.role = ANY (_roles)
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.prevent_unpaid_pppoe_provisioning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_restricted_staff boolean;
BEGIN
  IF v_user_id IS NULL OR NEW.customer_type <> 'pppoe' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND ur.tenant_id = NEW.tenant_id
      AND ur.role IN ('billing_agent', 'support_staff')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND (
        ur.role = 'super_admin'
        OR (ur.tenant_id = NEW.tenant_id AND ur.role IN ('tenant_admin', 'technician'))
      )
  )
  INTO v_restricted_staff;

  IF NOT v_restricted_staff THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'Only tenant administrators can provision PPPoE service without verified payment.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      OLD.customer_type IS DISTINCT FROM NEW.customer_type
      OR OLD.status IS DISTINCT FROM NEW.status
      OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    )
  THEN
    RAISE EXCEPTION 'Only verified payment or a tenant administrator can change PPPoE service status or expiry.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_unpaid_pppoe_provisioning() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customers_prevent_unpaid_pppoe_provisioning ON public.customers;
CREATE TRIGGER customers_prevent_unpaid_pppoe_provisioning
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unpaid_pppoe_provisioning();
-- END MIGRATION: supabase/migrations/20261130000000_restrict_free_pppoe_and_role_oracles.sql

-- BEGIN MIGRATION: supabase/migrations/20261201000000_require_verified_pppoe_and_daraja_success.sql
CREATE OR REPLACE FUNCTION public.prevent_unpaid_pppoe_provisioning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_restricted_staff boolean;
BEGIN
  IF v_user_id IS NULL OR NEW.customer_type <> 'pppoe' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND ur.tenant_id = NEW.tenant_id
      AND ur.role IN ('billing_agent', 'support_staff', 'technician')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND (
        ur.role = 'super_admin'
        OR (ur.tenant_id = NEW.tenant_id AND ur.role = 'tenant_admin')
      )
  )
  INTO v_restricted_staff;

  IF NOT v_restricted_staff THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'Only tenant administrators can provision PPPoE service without verified payment.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      OLD.customer_type IS DISTINCT FROM NEW.customer_type
      OR OLD.status IS DISTINCT FROM NEW.status
      OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    )
  THEN
    RAISE EXCEPTION 'Only verified payment or a tenant administrator can change PPPoE service status or expiry.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_unpaid_pppoe_provisioning() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customers_prevent_unpaid_pppoe_provisioning ON public.customers;
CREATE TRIGGER customers_prevent_unpaid_pppoe_provisioning
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unpaid_pppoe_provisioning();
-- END MIGRATION: supabase/migrations/20261201000000_require_verified_pppoe_and_daraja_success.sql

-- BEGIN MIGRATION: supabase/migrations/20261202000000_customer_invoicing.sql
CREATE SEQUENCE IF NOT EXISTS public.customer_invoice_number_seq;

CREATE TABLE IF NOT EXISTS public.customer_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  package_name text NOT NULL,
  invoice_number text NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'overdue', 'paid', 'void')),
  service_period_start timestamptz NOT NULL,
  service_period_end timestamptz NOT NULL,
  duration_value integer NOT NULL CHECK (duration_value > 0),
  duration_unit text NOT NULL CHECK (duration_unit IN ('minutes', 'hours', 'days', 'weeks', 'months')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (service_period_end > service_period_start),
  UNIQUE (tenant_id, invoice_number)
);

ALTER TABLE public.customer_invoices
  ADD COLUMN IF NOT EXISTS duration_value integer,
  ADD COLUMN IF NOT EXISTS duration_unit text,
  ADD COLUMN IF NOT EXISTS package_name text;

UPDATE public.customer_invoices AS invoice
   SET duration_value = COALESCE(invoice.duration_value, package.duration_value),
       duration_unit = COALESCE(invoice.duration_unit, package.duration_unit),
       package_name = COALESCE(invoice.package_name, package.name)
  FROM public.packages AS package
 WHERE package.id = invoice.package_id
   AND (
     invoice.duration_value IS NULL
     OR invoice.duration_unit IS NULL
     OR invoice.package_name IS NULL
   );

ALTER TABLE public.customer_invoices
  ALTER COLUMN duration_value SET NOT NULL,
  ALTER COLUMN duration_unit SET NOT NULL,
  ALTER COLUMN package_name SET NOT NULL,
  DROP CONSTRAINT IF EXISTS customer_invoices_duration_value_check,
  DROP CONSTRAINT IF EXISTS customer_invoices_duration_unit_check,
  ADD CONSTRAINT customer_invoices_duration_value_check CHECK (duration_value > 0),
  ADD CONSTRAINT customer_invoices_duration_unit_check
    CHECK (duration_unit IN ('minutes', 'hours', 'days', 'weeks', 'months'));

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS customer_invoice_id uuid
    REFERENCES public.customer_invoices(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_invoices_customer_period_key
  ON public.customer_invoices (customer_id, service_period_start);
CREATE INDEX IF NOT EXISTS customer_invoices_tenant_status_due_idx
  ON public.customer_invoices (tenant_id, status, due_at DESC);
CREATE INDEX IF NOT EXISTS customer_invoices_customer_issued_idx
  ON public.customer_invoices (customer_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS payments_customer_invoice_idx
  ON public.payments (customer_invoice_id)
  WHERE customer_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_invoices_payment_id_key
  ON public.customer_invoices (payment_id)
  WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_single_active_invoice_payment_idx
  ON public.payments (customer_invoice_id)
  WHERE customer_invoice_id IS NOT NULL
    AND status IN ('pending', 'processing');

ALTER TABLE public.customer_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer invoices tenant billing read" ON public.customer_invoices;
CREATE POLICY "customer invoices tenant billing read" ON public.customer_invoices
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(),
      tenant_id,
      ARRAY['tenant_admin', 'billing_agent']::public.app_role[]
    )
  );
REVOKE ALL ON public.customer_invoices FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.customer_invoices FROM authenticated;
GRANT SELECT ON public.customer_invoices TO authenticated;
GRANT ALL ON public.customer_invoices TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.customer_invoice_number_seq TO service_role;

CREATE OR REPLACE FUNCTION public.generate_due_customer_invoices(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer record;
  v_period_end timestamptz;
  v_invoice_number text;
  v_count integer := 0;
BEGIN
  UPDATE public.customer_invoices
     SET status = 'overdue'
   WHERE status = 'pending'
     AND due_at <= p_now;

  FOR v_customer IN
    SELECT
      c.id,
      c.tenant_id,
      c.package_id,
      c.expires_at,
      pkg.name,
      pkg.price,
      pkg.duration_value,
      pkg.duration_unit
    FROM public.customers AS c
    JOIN public.packages AS pkg
      ON pkg.id = c.package_id
     AND pkg.tenant_id = c.tenant_id
     AND pkg.kind = 'pppoe'
    WHERE c.customer_type = 'pppoe'
      AND c.status = 'active'
      AND c.expires_at IS NOT NULL
      AND c.expires_at <= p_now
      AND pkg.price > 0
      AND pkg.duration_value > 0
      AND pkg.duration_unit IN ('minutes', 'hours', 'days', 'weeks', 'months')
      AND pkg.duration_value <= 2147483647
      AND NOT EXISTS (
        SELECT 1
          FROM public.payments AS payment
         WHERE payment.tenant_id = c.tenant_id
           AND payment.customer_id = c.id
           AND payment.status IN ('pending', 'processing')
      )
    ORDER BY c.expires_at, c.id
  LOOP
    v_period_end := v_customer.expires_at + CASE v_customer.duration_unit
      WHEN 'minutes' THEN v_customer.duration_value * interval '1 minute'
      WHEN 'hours' THEN v_customer.duration_value * interval '1 hour'
      WHEN 'days' THEN v_customer.duration_value * interval '1 day'
      WHEN 'weeks' THEN v_customer.duration_value * interval '1 week'
      WHEN 'months' THEN v_customer.duration_value * interval '30 days'
    END;
    v_invoice_number := 'C-' || to_char(p_now AT TIME ZONE 'Africa/Nairobi', 'YYYYMM')
      || '-' || lpad(nextval('public.customer_invoice_number_seq')::text, 8, '0');

    INSERT INTO public.customer_invoices (
      tenant_id, customer_id, package_id, invoice_number, amount, status,
      package_name, service_period_start, service_period_end, duration_value, duration_unit,
      issued_at, due_at
    )
    VALUES (
      v_customer.tenant_id,
      v_customer.id,
      v_customer.package_id,
      v_invoice_number,
      ceil(v_customer.price),
      'pending',
      v_customer.name,
      v_customer.expires_at,
      v_period_end,
      v_customer.duration_value,
      v_customer.duration_unit,
      p_now,
      v_customer.expires_at + interval '3 days'
    )
    ON CONFLICT (customer_id, service_period_start) DO NOTHING;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_due_customer_invoices(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_due_customer_invoices(timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_customer_invoice_payment(
  p_payment_id uuid,
  p_receipt text,
  p_raw_callback jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_invoice public.customer_invoices%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_expires_at timestamptz;
  v_updated integer;
BEGIN
  SELECT * INTO v_payment
    FROM public.payments
   WHERE id = p_payment_id
     AND status = 'processing'
     AND customer_invoice_id IS NOT NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice payment is not available for settlement';
  END IF;
  IF p_receipt IS NULL OR length(trim(p_receipt)) = 0 THEN
    RAISE EXCEPTION 'Invoice payment requires a verified receipt';
  END IF;

  SELECT * INTO v_invoice
    FROM public.customer_invoices
   WHERE id = v_payment.customer_invoice_id
     AND tenant_id = v_payment.tenant_id
     AND customer_id = v_payment.customer_id
     AND package_id = v_payment.package_id
     AND amount = v_payment.amount
     AND status IN ('pending', 'overdue')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer invoice no longer matches this payment';
  END IF;

  SELECT * INTO v_customer
    FROM public.customers
   WHERE id = v_payment.customer_id
     AND tenant_id = v_payment.tenant_id
     AND customer_type = 'pppoe'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPPoE account not found for this invoice';
  END IF;

  v_expires_at := greatest(COALESCE(v_customer.expires_at, now()), now())
    + CASE v_invoice.duration_unit
      WHEN 'minutes' THEN v_invoice.duration_value * interval '1 minute'
      WHEN 'hours' THEN v_invoice.duration_value * interval '1 hour'
      WHEN 'days' THEN v_invoice.duration_value * interval '1 day'
      WHEN 'weeks' THEN v_invoice.duration_value * interval '1 week'
      WHEN 'months' THEN v_invoice.duration_value * interval '30 days'
    END;

  UPDATE public.customers
     SET package_id = v_invoice.package_id,
         expires_at = v_expires_at,
         status = 'active'
   WHERE id = v_customer.id
     AND tenant_id = v_customer.tenant_id;

  UPDATE public.customer_invoices
     SET status = 'paid',
         paid_at = now(),
         payment_id = v_payment.id,
         service_period_start = greatest(COALESCE(v_customer.expires_at, now()), now()),
         service_period_end = v_expires_at
   WHERE id = v_payment.customer_invoice_id
     AND tenant_id = v_payment.tenant_id
     AND customer_id = v_payment.customer_id
     AND package_id = v_payment.package_id
     AND amount = v_payment.amount;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Customer invoice no longer matches this payment';
  END IF;

  UPDATE public.payments
     SET status = 'success',
         mpesa_receipt = p_receipt,
         raw_callback = p_raw_callback,
         expires_at = v_expires_at
   WHERE id = v_payment.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_customer_invoice_payment(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_customer_invoice_payment(uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.approve_direct_mpesa_transaction(
  p_transaction_id uuid,
  p_tenant_id uuid,
  p_customer_id uuid,
  p_package_id uuid,
  p_expires_at timestamptz,
  p_reviewed_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transaction public.direct_mpesa_transactions%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_package public.packages%ROWTYPE;
  v_invoice public.customer_invoices%ROWTYPE;
  v_payment_id uuid;
  v_expires_at timestamptz;
BEGIN
  SELECT * INTO v_transaction
    FROM public.direct_mpesa_transactions
   WHERE id = p_transaction_id
     AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND OR v_transaction.status <> 'received' THEN
    RAISE EXCEPTION 'This transaction is no longer awaiting review';
  END IF;

  SELECT * INTO v_customer
    FROM public.customers
   WHERE id = p_customer_id
     AND tenant_id = p_tenant_id
     AND customer_type = 'pppoe'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select a PPPoE customer belonging to this tenant';
  END IF;

  SELECT * INTO v_invoice
    FROM public.customer_invoices
   WHERE customer_id = p_customer_id
     AND tenant_id = p_tenant_id
     AND package_id = p_package_id
     AND amount = v_transaction.amount
     AND status IN ('pending', 'overdue')
   ORDER BY issued_at DESC
   LIMIT 1
   FOR UPDATE;

  SELECT * INTO v_package
    FROM public.packages
   WHERE id = p_package_id
     AND tenant_id = p_tenant_id
     AND kind = 'pppoe'
     AND (v_invoice.id IS NOT NULL OR active IS TRUE);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select an available PPPoE package belonging to this tenant';
  END IF;

  IF v_invoice.id IS NULL THEN
    IF v_package.price IS NULL OR ceil(v_package.price) <> v_transaction.amount THEN
      RAISE EXCEPTION 'The selected active PPPoE package price does not match this payment';
    END IF;
    IF p_expires_at IS NULL OR p_expires_at <= now() THEN
      RAISE EXCEPTION 'Invalid subscription expiry';
    END IF;
    v_expires_at := p_expires_at;
  ELSE
    v_expires_at := greatest(COALESCE(v_customer.expires_at, now()), now())
      + CASE v_invoice.duration_unit
        WHEN 'minutes' THEN v_invoice.duration_value * interval '1 minute'
        WHEN 'hours' THEN v_invoice.duration_value * interval '1 hour'
        WHEN 'days' THEN v_invoice.duration_value * interval '1 day'
        WHEN 'weeks' THEN v_invoice.duration_value * interval '1 week'
        WHEN 'months' THEN v_invoice.duration_value * interval '30 days'
      END;
  END IF;

  INSERT INTO public.payments (
    tenant_id, customer_id, package_id, customer_invoice_id, phone, amount,
    mpesa_receipt, status, provider, raw_callback, created_at, expires_at
  )
  VALUES (
    p_tenant_id, p_customer_id, p_package_id, v_invoice.id, v_transaction.phone,
    v_transaction.amount, v_transaction.transaction_id, 'success', 'daraja',
    v_transaction.raw_payload, v_transaction.transaction_time, v_expires_at
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.customers
     SET package_id = p_package_id,
         expires_at = v_expires_at,
         status = 'active'
   WHERE id = p_customer_id
     AND tenant_id = p_tenant_id;

  IF v_invoice.id IS NOT NULL THEN
    UPDATE public.customer_invoices
       SET status = 'paid',
           paid_at = now(),
           payment_id = v_payment_id,
           service_period_start = greatest(COALESCE(v_customer.expires_at, now()), now()),
           service_period_end = v_expires_at
     WHERE id = v_invoice.id;
  END IF;

  UPDATE public.direct_mpesa_transactions
     SET status = 'approved',
         customer_id = p_customer_id,
         payment_id = v_payment_id,
         reviewed_by = p_reviewed_by,
         reviewed_at = now()
   WHERE id = p_transaction_id;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_direct_mpesa_transaction(
  uuid, uuid, uuid, uuid, timestamptz, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_direct_mpesa_transaction(
  uuid, uuid, uuid, uuid, timestamptz, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_stale_stk_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired integer;
BEGIN
  UPDATE public.payments
     SET status = 'failed'
   WHERE created_at < now() - interval '10 minutes'
     AND (
       status = 'pending'
       OR (status = 'processing' AND customer_invoice_id IS NOT NULL)
     );

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$$;
-- END MIGRATION: supabase/migrations/20261202000000_customer_invoicing.sql

-- BEGIN MIGRATION: supabase/migrations/20261203000000_customer_billing_primitives.sql
CREATE TABLE IF NOT EXISTS public.customer_invoice_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.customer_invoices(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, payment_id)
);

CREATE TABLE IF NOT EXISTS public.customer_invoice_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.customer_invoices(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('credit', 'discount', 'fee', 'writeoff', 'manual_adjustment')),
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  note text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_invoices
  DROP CONSTRAINT IF EXISTS customer_invoices_status_check,
  ADD CONSTRAINT customer_invoices_status_check
    CHECK (status IN ('pending', 'overdue', 'partial', 'paid', 'void'));

CREATE INDEX IF NOT EXISTS customer_invoice_allocations_invoice_idx
  ON public.customer_invoice_allocations (invoice_id, allocated_at DESC);
CREATE INDEX IF NOT EXISTS customer_invoice_adjustments_invoice_idx
  ON public.customer_invoice_adjustments (invoice_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.customer_invoice_open_balance(p_invoice_id uuid)
RETURNS numeric(12,2)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    invoice.amount
    + COALESCE((
      SELECT SUM(adj.amount)
      FROM public.customer_invoice_adjustments AS adj
      WHERE adj.invoice_id = p_invoice_id
    ), 0)
    - COALESCE((
      SELECT SUM(alloc.amount)
      FROM public.customer_invoice_allocations AS alloc
      WHERE alloc.invoice_id = p_invoice_id
    ), 0)
  FROM public.customer_invoices AS invoice
  WHERE invoice.id = p_invoice_id;
$$;

REVOKE ALL ON FUNCTION public.customer_invoice_open_balance(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_invoice_open_balance(uuid)
  TO service_role;
-- END MIGRATION: supabase/migrations/20261203000000_customer_billing_primitives.sql

-- BEGIN MIGRATION: supabase/migrations/20261204000000_field_work_orders.sql
CREATE TABLE IF NOT EXISTS public.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  scheduled_at timestamptz,
  resolution_notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS work_orders_tenant_status_scheduled_idx
  ON public.work_orders (tenant_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS work_orders_assignee_status_scheduled_idx
  ON public.work_orders (assigned_to, status, scheduled_at)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_orders_customer_created_idx
  ON public.work_orders (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_orders_ticket_idx
  ON public.work_orders (ticket_id)
  WHERE ticket_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_work_order_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'work order tenant cannot be changed' USING ERRCODE = '42501';
  END IF;

  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'work order customer must belong to its tenant' USING ERRCODE = '42501';
  END IF;

  IF NEW.ticket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE id = NEW.ticket_id
      AND tenant_id = NEW.tenant_id
      AND (NEW.customer_id IS NULL OR customer_id = NEW.customer_id)
  ) THEN
    RAISE EXCEPTION 'work order ticket must match its tenant and customer' USING ERRCODE = '42501';
  END IF;

  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.assigned_to
      AND tenant_id = NEW.tenant_id
      AND role IN ('tenant_admin', 'technician')
  ) THEN
    RAISE EXCEPTION 'work order assignee must be a technician or admin in its tenant'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now();
  IF NEW.status = 'completed' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.completed_at := now();
    ELSIF OLD.status <> 'completed' THEN
      NEW.completed_at := now();
    ELSE
      NEW.completed_at := OLD.completed_at;
    END IF;
  ELSIF NEW.status <> 'completed' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_work_order_scope ON public.work_orders;
CREATE TRIGGER validate_work_order_scope
  BEFORE INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_work_order_scope();
REVOKE ALL ON FUNCTION public.validate_work_order_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_work_order_scope() TO service_role;

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "work orders require aal2" ON public.work_orders;
CREATE POLICY "work orders require aal2" ON public.work_orders
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2())
  WITH CHECK (public.is_aal2());

DROP POLICY IF EXISTS "work orders read by role" ON public.work_orders;
CREATE POLICY "work orders read by role" ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin', 'support_staff']::public.app_role[]
    )
    OR (
      public.has_tenant_role(auth.uid(), tenant_id, ARRAY['technician']::public.app_role[])
      AND assigned_to = auth.uid()
    )
  );

DROP POLICY IF EXISTS "work orders insert by role" ON public.work_orders;
CREATE POLICY "work orders insert by role" ON public.work_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]
    )
    OR (
      public.has_tenant_role(auth.uid(), tenant_id, ARRAY['technician']::public.app_role[])
      AND assigned_to = auth.uid()
    )
  );

DROP POLICY IF EXISTS "work orders update by role" ON public.work_orders;
CREATE POLICY "work orders update by role" ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]
    )
    OR (
      public.has_tenant_role(auth.uid(), tenant_id, ARRAY['technician']::public.app_role[])
      AND assigned_to = auth.uid()
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]
    )
    OR (
      public.has_tenant_role(auth.uid(), tenant_id, ARRAY['technician']::public.app_role[])
      AND assigned_to = auth.uid()
    )
  );

DROP POLICY IF EXISTS "work orders delete by role" ON public.work_orders;
CREATE POLICY "work orders delete by role" ON public.work_orders
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  );

REVOKE ALL ON public.work_orders FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_orders TO authenticated;
GRANT ALL ON public.work_orders TO service_role;
-- END MIGRATION: supabase/migrations/20261204000000_field_work_orders.sql

-- BEGIN MIGRATION: supabase/migrations/20261205000000_unique_ticket_work_orders.sql
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_ticket_id_unique_idx
  ON public.work_orders (ticket_id)
  WHERE ticket_id IS NOT NULL;
-- END MIGRATION: supabase/migrations/20261205000000_unique_ticket_work_orders.sql

-- BEGIN MIGRATION: supabase/migrations/20261206000000_customer_documents.sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customer-documents',
  'customer-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "customer documents staff read" ON storage.objects;
CREATE POLICY "customer documents staff read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'customer-documents'
    AND public.is_aal2()
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.tenant_id::text = (storage.foldername(name))[1]
        AND (
          public.is_super_admin(auth.uid())
          OR public.has_tenant_role(
            auth.uid(),
            c.tenant_id,
            ARRAY['tenant_admin', 'technician', 'support_staff']::public.app_role[]
          )
        )
    )
  );

DROP POLICY IF EXISTS "customer documents staff upload" ON storage.objects;
CREATE POLICY "customer documents staff upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'customer-documents'
    AND public.is_aal2()
    AND owner_id = auth.uid()::text
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.tenant_id::text = (storage.foldername(name))[1]
        AND (
          public.is_super_admin(auth.uid())
          OR public.has_tenant_role(
            auth.uid(),
            c.tenant_id,
            ARRAY['tenant_admin', 'technician', 'support_staff']::public.app_role[]
          )
        )
    )
  );

DROP POLICY IF EXISTS "customer documents staff delete" ON storage.objects;
CREATE POLICY "customer documents staff delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'customer-documents'
    AND public.is_aal2()
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.tenant_id::text = (storage.foldername(name))[1]
        AND (
          public.is_super_admin(auth.uid())
          OR public.has_tenant_role(
            auth.uid(),
            c.tenant_id,
            ARRAY['tenant_admin', 'technician', 'support_staff']::public.app_role[]
          )
        )
    )
  );
-- END MIGRATION: supabase/migrations/20261206000000_customer_documents.sql

-- BEGIN MIGRATION: supabase/migrations/20261207000000_ticket_priorities.sql
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

UPDATE public.support_tickets
SET priority = 'normal'
WHERE priority IS NULL
   OR priority NOT IN ('low', 'normal', 'high', 'urgent');

ALTER TABLE public.support_tickets
  ALTER COLUMN priority SET DEFAULT 'normal',
  ALTER COLUMN priority SET NOT NULL;

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_priority_check;

ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
-- END MIGRATION: supabase/migrations/20261207000000_ticket_priorities.sql

-- BEGIN MIGRATION: supabase/migrations/20261208000000_ticket_assignment.sql
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.validate_support_ticket_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    IF NOT public.is_super_admin(auth.uid())
       AND NOT public.has_tenant_role(
         auth.uid(),
         NEW.tenant_id,
         ARRAY['tenant_admin']::public.app_role[]
       ) THEN
      RAISE EXCEPTION 'Only tenant admins can assign support tickets';
    END IF;

    IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = NEW.assigned_to
        AND ur.tenant_id = NEW.tenant_id
        AND ur.role = ANY (
          ARRAY['tenant_admin', 'technician', 'support_staff']::public.app_role[]
        )
    ) THEN
      RAISE EXCEPTION 'Support tickets can only be assigned to tenant support staff';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_support_ticket_assignee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS validate_support_ticket_assignee ON public.support_tickets;
CREATE TRIGGER validate_support_ticket_assignee
  BEFORE INSERT OR UPDATE OF assigned_to, tenant_id ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_support_ticket_assignee();
-- END MIGRATION: supabase/migrations/20261208000000_ticket_assignment.sql

-- BEGIN MIGRATION: supabase/migrations/20261209000000_inventory_warranty_dates.sql
ALTER TABLE public.inventory_devices
  ADD COLUMN IF NOT EXISTS warranty_expires_on date;

GRANT INSERT (warranty_expires_on)
  ON public.inventory_devices TO authenticated;
GRANT UPDATE (warranty_expires_on)
  ON public.inventory_devices TO authenticated;
-- END MIGRATION: supabase/migrations/20261209000000_inventory_warranty_dates.sql

-- BEGIN MIGRATION: supabase/migrations/20261210000000_demo_workspaces.sql
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.prevent_tenant_demo_flag_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND NEW.is_demo IS DISTINCT FROM OLD.is_demo THEN
    RAISE EXCEPTION 'Only the demo setup flow can change the demo workspace flag'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_tenant_demo_flag_changes() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS prevent_tenant_demo_flag_changes ON public.tenants;
CREATE TRIGGER prevent_tenant_demo_flag_changes
  BEFORE UPDATE OF is_demo ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_demo_flag_changes();

CREATE OR REPLACE FUNCTION public.seed_demo_workspace()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_is_demo boolean;
  v_router_cbd uuid := gen_random_uuid();
  v_router_estates uuid := gen_random_uuid();
  v_hotspot_hour uuid := gen_random_uuid();
  v_hotspot_day uuid := gen_random_uuid();
  v_pppoe_home uuid := gen_random_uuid();
  v_pppoe_business uuid := gen_random_uuid();
  v_customer_hotspot uuid := gen_random_uuid();
  v_customer_pppoe uuid := gen_random_uuid();
  v_customer_overdue uuid := gen_random_uuid();
  v_ticket_id uuid := gen_random_uuid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before creating a demo workspace' USING ERRCODE = '42501';
  END IF;

  SELECT p.tenant_id
  INTO v_tenant_id
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF v_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND ur.tenant_id = v_tenant_id
      AND ur.role = 'tenant_admin'
  ) THEN
    RAISE EXCEPTION 'Only a tenant administrator can create a demo workspace'
      USING ERRCODE = '42501';
  END IF;

  SELECT t.is_demo
  INTO v_is_demo
  FROM public.tenants t
  WHERE t.id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_is_demo THEN
    RETURN v_tenant_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.routers WHERE tenant_id = v_tenant_id
    UNION ALL
    SELECT 1 FROM public.packages WHERE tenant_id = v_tenant_id
    UNION ALL
    SELECT 1 FROM public.customers WHERE tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Sample data can only be loaded into a new workspace'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.tenants
  SET is_demo = true
  WHERE id = v_tenant_id;

  INSERT INTO public.routers (id, tenant_id, name, model, vendor, status, last_seen_at, cpu_usage, ram_usage)
  VALUES
    (v_router_cbd, v_tenant_id, 'Demo - Nairobi CBD', 'hEX S', 'mikrotik', 'online', now(), 24, 38),
    (v_router_estates, v_tenant_id, 'Demo - Greenview Estate', 'RB4011', 'mikrotik', 'offline', now() - interval '18 minutes', 0, 0);

  INSERT INTO public.packages (
    id, tenant_id, name, description, kind, price, duration_value, duration_unit,
    data_limit_mb, unlimited, upload_kbps, download_kbps, device_limit,
    simultaneous_logins, active
  )
  VALUES
    (v_hotspot_hour, v_tenant_id, 'Demo Hotspot - 1 Hour', 'Sample prepaid hotspot pass', 'hotspot', 50, 1, 'hours', 1024, false, 2048, 5120, 1, 1, true),
    (v_hotspot_day, v_tenant_id, 'Demo Hotspot - 1 Day', 'Sample day pass with generous data', 'hotspot', 150, 1, 'days', 5120, false, 5120, 10240, 2, 2, true),
    (v_pppoe_home, v_tenant_id, 'Demo Home - 20 Mbps', 'Sample residential PPPoE plan', 'pppoe', 2500, 1, 'months', NULL, true, 10000, 20000, 1, 1, true),
    (v_pppoe_business, v_tenant_id, 'Demo Business - 50 Mbps', 'Sample business PPPoE plan', 'pppoe', 6500, 1, 'months', NULL, true, 25000, 50000, 1, 1, true);

  INSERT INTO public.customers (
    id, tenant_id, full_name, phone, email, customer_type, pppoe_username,
    pppoe_password, status, package_id, router_id, expires_at, last_seen_at,
    last_router_id, last_ip, last_mac, data_used_bytes
  )
  VALUES
    (v_customer_hotspot, v_tenant_id, 'Demo Customer - Amina', '0000000001', 'amina@example.invalid', 'hotspot', NULL, NULL, 'active', v_hotspot_day, v_router_cbd, now() + interval '12 hours', now() - interval '4 minutes', v_router_cbd, '192.0.2.41', '02:00:00:00:00:41', 734003200),
    (v_customer_pppoe, v_tenant_id, 'Demo Customer - Brian', '0000000002', 'brian@example.invalid', 'pppoe', 'demo_brian', 'sample-only-password', 'active', v_pppoe_home, v_router_cbd, now() + interval '12 days', now() - interval '2 minutes', v_router_cbd, '192.0.2.52', '02:00:00:00:00:52', 5368709120),
    (v_customer_overdue, v_tenant_id, 'Demo Customer - Wanjiku', '0000000003', 'wanjiku@example.invalid', 'pppoe', 'demo_wanjiku', 'sample-only-password', 'suspended', v_pppoe_business, v_router_estates, now() - interval '3 days', now() - interval '4 days', v_router_estates, '192.0.2.63', '02:00:00:00:00:63', 0);

  INSERT INTO public.sessions (
    tenant_id, customer_id, router_id, mac_address, ip_address,
    started_at, bytes_in, bytes_out, status
  )
  VALUES
    (v_tenant_id, v_customer_hotspot, v_router_cbd, '02:00:00:00:00:41', '192.0.2.41', now() - interval '42 minutes', 102400000, 634003200, 'active'),
    (v_tenant_id, v_customer_pppoe, v_router_cbd, '02:00:00:00:00:52', '192.0.2.52', now() - interval '3 hours', 2147483648, 3221225472, 'active'),
    (v_tenant_id, v_customer_overdue, v_router_estates, '02:00:00:00:00:63', '192.0.2.63', now() - interval '5 days', 0, 0, 'ended');

  INSERT INTO public.payments (
    tenant_id, customer_id, package_id, phone, amount, mpesa_receipt,
    provider, status, raw_callback, created_at
  )
  VALUES
    (v_tenant_id, v_customer_hotspot, v_hotspot_day, '0000000001', 150, 'DEMO-' || replace(v_tenant_id::text, '-', '') || '-001', 'daraja', 'success', '{"demo":true}'::jsonb, now() - interval '20 minutes'),
    (v_tenant_id, v_customer_pppoe, v_pppoe_home, '0000000002', 2500, 'DEMO-' || replace(v_tenant_id::text, '-', '') || '-002', 'daraja', 'success', '{"demo":true}'::jsonb, now() - interval '1 day'),
    (v_tenant_id, v_customer_overdue, v_pppoe_business, '0000000003', 6500, NULL, 'daraja', 'failed', '{"demo":true}'::jsonb, now() - interval '2 days');

  INSERT INTO public.captive_portals (tenant_id, primary_color, welcome_text, terms_text)
  VALUES (
    v_tenant_id,
    '#176b5b',
    'Welcome to the Demo Network. Choose a package to get connected.',
    'This sample portal is for demonstration only.'
  );

  INSERT INTO public.inventory_items (tenant_id, category, name, brand, model, quantity, reorder_level, unit_cost, notes)
  VALUES
    (v_tenant_id, 'router', 'Demo Router Stock', 'MikroTik', 'hEX S', 4, 2, 9500, 'Fictional demo inventory'),
    (v_tenant_id, 'ont', 'Demo Fibre ONT', 'Generic', 'GPON-ONT', 12, 5, 2800, 'Fictional demo inventory');

  INSERT INTO public.support_tickets (id, tenant_id, customer_id, subject, body, status, created_at)
  VALUES (
    v_ticket_id,
    v_tenant_id,
    v_customer_hotspot,
    'Demo: connection is slower than expected',
    'Sample support request for exploring the customer support workflow.',
    'open',
    now() - interval '1 hour'
  );

  INSERT INTO public.work_orders (tenant_id, customer_id, ticket_id, title, description, status, priority, scheduled_at)
  VALUES (
    v_tenant_id,
    v_customer_hotspot,
    v_ticket_id,
    'Demo: check access point coverage',
    'Sample field visit. No real customer or address is associated with this record.',
    'scheduled',
    'normal',
    now() + interval '1 day'
  );

  RETURN v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_demo_workspace() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_demo_workspace() TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_monthly_platform_commission_invoices(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_month timestamp;
  v_month timestamp;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_tenant record;
  v_existing public.platform_commissions%ROWTYPE;
  v_tracking_start timestamptz;
  v_invoice_number text;
  v_count integer := 0;
BEGIN
  v_local_month := date_trunc('month', p_now AT TIME ZONE 'Africa/Nairobi');
  SELECT commission_tracking_starts_at
  INTO v_tracking_start
  FROM public.platform_billing_config
  WHERE id = 1;

  FOR v_month IN
    SELECT DISTINCT date_trunc('month', p.created_at AT TIME ZONE 'Africa/Nairobi')
    FROM public.payments p
    WHERE p.status = 'success'
      AND p.created_at >= v_tracking_start
      AND p.created_at < (v_local_month AT TIME ZONE 'Africa/Nairobi')
    ORDER BY 1
  LOOP
    v_period_start := v_month AT TIME ZONE 'Africa/Nairobi';
    v_period_end := (v_month + interval '1 month') AT TIME ZONE 'Africa/Nairobi';

    FOR v_tenant IN
      SELECT
        t.id,
        t.slug,
        t.platform_commission_pct,
        sum(p.amount)::numeric(14,2) AS gross_amount,
        round(sum(p.amount) * t.platform_commission_pct / 100, 2)::numeric(14,2)
          AS commission_amount
      FROM public.payments p
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.status = 'success'
        AND NOT t.is_demo
        AND p.created_at >= GREATEST(v_period_start, v_tracking_start)
        AND p.created_at < v_period_end
      GROUP BY t.id, t.slug, t.platform_commission_pct
      HAVING round(sum(p.amount) * t.platform_commission_pct / 100, 2) > 0
    LOOP
      v_invoice_number :=
        'INV-' || to_char(v_month, 'YYYYMM') || '-' ||
        upper(replace(v_tenant.id::text, '-', ''));

      SELECT pc.*
      INTO v_existing
      FROM public.platform_commissions pc
      WHERE pc.tenant_id = v_tenant.id
        AND pc.period_start < v_period_end
        AND pc.period_end >= v_period_start
      ORDER BY (pc.status = 'collected') DESC, pc.created_at
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        IF v_existing.status <> 'collected' AND v_existing.invoice_number IS NULL THEN
          UPDATE public.platform_commissions
          SET period_start = v_period_start,
              period_end = v_period_end,
              gross_amount = v_tenant.gross_amount,
              commission_amount = v_tenant.commission_amount,
              commission_rate_pct = v_tenant.platform_commission_pct,
              invoice_number = COALESCE(invoice_number, v_invoice_number),
              issued_at = COALESCE(issued_at, p_now),
              due_at = COALESCE(due_at, p_now + interval '72 hours'),
              email_status = CASE
                WHEN invoice_number IS NULL THEN 'pending'
                ELSE email_status
              END
          WHERE id = v_existing.id;
          v_count := v_count + 1;
        END IF;
      ELSE
        INSERT INTO public.platform_commissions (
          tenant_id,
          period_start,
          period_end,
          gross_amount,
          commission_amount,
          commission_rate_pct,
          invoice_number,
          issued_at,
          due_at,
          status,
          email_status
        )
        VALUES (
          v_tenant.id,
          v_period_start,
          v_period_end,
          v_tenant.gross_amount,
          v_tenant.commission_amount,
          v_tenant.platform_commission_pct,
          v_invoice_number,
          p_now,
          p_now + interval '72 hours',
          'pending',
          'pending'
        )
        ON CONFLICT (tenant_id, period_start, period_end) DO NOTHING;
        IF FOUND THEN
          v_count := v_count + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END
$$;
-- END MIGRATION: supabase/migrations/20261210000000_demo_workspaces.sql

-- BEGIN MIGRATION: supabase/migrations/20261211000000_demo_viewer_role.sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'demo_viewer';
-- END MIGRATION: supabase/migrations/20261211000000_demo_viewer_role.sql

-- BEGIN MIGRATION: supabase/migrations/20261212000000_demo_viewer_readonly.sql
CREATE OR REPLACE FUNCTION public.is_demo_tenant(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = p_tenant_id
      AND t.is_demo
  )
$$;

REVOKE ALL ON FUNCTION public.is_demo_tenant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_demo_tenant(uuid) TO authenticated;

DO $$
DECLARE
  v_table record;
  v_policy record;
BEGIN
  FOR v_table IN
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      v_table.relname
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'demo viewer read ' || v_table.relname,
      v_table.relname
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ('
      'public.is_demo_tenant(tenant_id) AND public.has_tenant_role('
      'auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[]))',
      'demo viewer read ' || v_table.relname,
      v_table.relname
    );

    FOR v_policy IN
      SELECT * FROM (VALUES
        ('INSERT', 'WITH CHECK (NOT (public.is_demo_tenant(tenant_id) AND public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[])))'),
        ('UPDATE', 'USING (NOT (public.is_demo_tenant(tenant_id) AND public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[]))) WITH CHECK (NOT (public.is_demo_tenant(tenant_id) AND public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[])))'),
        ('DELETE', 'USING (NOT (public.is_demo_tenant(tenant_id) AND public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[])))')
      ) AS policies(command, clause)
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        'demo viewer deny ' || lower(v_policy.command) || ' ' || v_table.relname,
        v_table.relname
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',
        'demo viewer deny ' || lower(v_policy.command) || ' ' || v_table.relname,
        v_table.relname,
        v_policy.command,
        v_policy.clause
      );
    END LOOP;
  END LOOP;

  DROP POLICY IF EXISTS "demo viewer read tenant" ON public.tenants;
  CREATE POLICY "demo viewer read tenant" ON public.tenants
    FOR SELECT TO authenticated
    USING (
      is_demo
      AND public.has_tenant_role(
        auth.uid(), id, ARRAY['demo_viewer']::public.app_role[]
      )
    );

  FOR v_policy IN
    SELECT p.polname, p.polcmd, c.relname
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND p.polname LIKE '% require aal2'
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'tenant_id'
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
  LOOP
    IF v_policy.polcmd IN ('*', 'w') THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING (public.is_aal2() OR ('
        'public.is_demo_tenant(tenant_id) AND public.has_tenant_role('
        'auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[]))) '
        'WITH CHECK (public.is_aal2())',
        v_policy.polname,
        v_policy.relname
      );
    ELSIF v_policy.polcmd IN ('r', 'd') THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING (public.is_aal2() OR ('
        'public.is_demo_tenant(tenant_id) AND public.has_tenant_role('
        'auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[])))',
        v_policy.polname,
        v_policy.relname
      );
    ELSIF v_policy.polcmd = 'a' THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I WITH CHECK (public.is_aal2())',
        v_policy.polname,
        v_policy.relname
      );
    ELSE
      RAISE EXCEPTION 'Unexpected command % for AAL2 policy % on public.%',
        v_policy.polcmd, v_policy.polname, v_policy.relname;
    END IF;
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS "demo viewer deny tenant insert" ON public.tenants;
CREATE POLICY "demo viewer deny tenant insert" ON public.tenants
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.has_tenant_role(auth.uid(), id, ARRAY['demo_viewer']::public.app_role[]));
DROP POLICY IF EXISTS "demo viewer deny tenant update" ON public.tenants;
CREATE POLICY "demo viewer deny tenant update" ON public.tenants
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.has_tenant_role(auth.uid(), id, ARRAY['demo_viewer']::public.app_role[]))
  WITH CHECK (NOT public.has_tenant_role(auth.uid(), id, ARRAY['demo_viewer']::public.app_role[]));
DROP POLICY IF EXISTS "demo viewer deny tenant delete" ON public.tenants;
CREATE POLICY "demo viewer deny tenant delete" ON public.tenants
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.has_tenant_role(auth.uid(), id, ARRAY['demo_viewer']::public.app_role[]));
-- END MIGRATION: supabase/migrations/20261212000000_demo_viewer_readonly.sql

-- BEGIN MIGRATION: supabase/migrations/20261213000000_staff_internet_grants.sql
CREATE TABLE IF NOT EXISTS public.staff_internet_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  staff_name text NOT NULL,
  staff_phone text,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  access_type text NOT NULL CHECK (access_type IN ('hotspot', 'pppoe')),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  package_name text NOT NULL,
  retail_value numeric(10, 2) NOT NULL DEFAULT 0 CHECK (retail_value >= 0),
  voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  voucher_code text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  pppoe_username text,
  note text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (access_type = 'hotspot' AND customer_id IS NULL)
    OR (access_type = 'pppoe' AND voucher_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS staff_internet_grants_tenant_created_idx
  ON public.staff_internet_grants (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_internet_grants_staff_access_idx
  ON public.staff_internet_grants (tenant_id, staff_user_id, access_type, created_at DESC);

ALTER TABLE public.staff_internet_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff internet grants tenant read" ON public.staff_internet_grants;
CREATE POLICY "staff internet grants tenant read" ON public.staff_internet_grants
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin', 'billing_agent']::public.app_role[]
    )
  );
REVOKE ALL ON public.staff_internet_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_internet_grants TO authenticated;
GRANT ALL ON public.staff_internet_grants TO service_role;

DROP FUNCTION IF EXISTS public.grant_staff_internet(
  uuid, uuid, text, uuid, uuid, uuid, text, text, text
);

CREATE OR REPLACE FUNCTION public.grant_staff_internet(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_staff_user_id uuid,
  p_access_type text,
  p_hotspot_package_id uuid DEFAULT NULL,
  p_pppoe_package_id uuid DEFAULT NULL,
  p_router_id uuid DEFAULT NULL,
  p_pppoe_username text DEFAULT NULL,
  p_pppoe_password text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_staff_name text;
  v_staff_phone text;
  v_hotspot_package public.packages%ROWTYPE;
  v_pppoe_package public.packages%ROWTYPE;
  v_expires_at timestamptz;
  v_code text;
  v_voucher_id uuid;
  v_customer_id uuid;
  v_existing_customer_id uuid;
  v_hotspot_grant_id uuid;
  v_pppoe_grant_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Staff internet must be granted through the authenticated server action'
      USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_actor_id
      AND ur.tenant_id = p_tenant_id
      AND ur.role = 'tenant_admin'
  ) THEN
    RAISE EXCEPTION 'Only tenant administrators can grant staff internet'
      USING ERRCODE = '42501';
  END IF;
  v_tenant_id := p_tenant_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_staff_user_id
      AND ur.tenant_id = v_tenant_id
      AND ur.role = 'technician'
  ) THEN
    RAISE EXCEPTION 'Select a technician on your team' USING ERRCODE = '42501';
  END IF;

  IF p_access_type IS NULL OR p_access_type NOT IN ('hotspot', 'pppoe', 'both') THEN
    RAISE EXCEPTION 'Select hotspot, PPPoE, or both access types' USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      p.email
    ),
    p.phone
  INTO v_staff_name, v_staff_phone
  FROM public.profiles p
  WHERE p.id = p_staff_user_id;
  IF v_staff_name IS NULL THEN
    RAISE EXCEPTION 'Technician profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_access_type IN ('hotspot', 'both') THEN
    SELECT * INTO v_hotspot_package
    FROM public.packages
    WHERE id = p_hotspot_package_id
      AND tenant_id = v_tenant_id
      AND active
      AND kind IN ('hotspot', 'voucher');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Select an active hotspot package for this tenant'
        USING ERRCODE = '22023';
    END IF;
    IF v_hotspot_package.duration_value IS NULL OR v_hotspot_package.duration_value <= 0
      OR v_hotspot_package.duration_unit NOT IN ('minutes', 'hours', 'days', 'weeks', 'months') THEN
      RAISE EXCEPTION 'The hotspot package must have a valid duration' USING ERRCODE = '22023';
    END IF;

    v_expires_at := now() + CASE v_hotspot_package.duration_unit
      WHEN 'minutes' THEN v_hotspot_package.duration_value * interval '1 minute'
      WHEN 'hours' THEN v_hotspot_package.duration_value * interval '1 hour'
      WHEN 'days' THEN v_hotspot_package.duration_value * interval '1 day'
      WHEN 'weeks' THEN v_hotspot_package.duration_value * interval '1 week'
      WHEN 'months' THEN v_hotspot_package.duration_value * interval '30 days'
    END;

    LOOP
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.vouchers
        WHERE tenant_id = v_tenant_id AND code = v_code
      );
    END LOOP;

    INSERT INTO public.vouchers (tenant_id, package_id, code)
    VALUES (v_tenant_id, v_hotspot_package.id, v_code)
    RETURNING id INTO v_voucher_id;

    INSERT INTO public.staff_internet_grants (
      tenant_id, staff_user_id, staff_name, staff_phone, granted_by, access_type, package_id,
      package_name, retail_value, voucher_id, voucher_code, note, expires_at
    )
    VALUES (
      v_tenant_id, p_staff_user_id, v_staff_name, v_staff_phone, p_actor_id, 'hotspot', v_hotspot_package.id,
      v_hotspot_package.name, v_hotspot_package.price, v_voucher_id, v_code,
      NULLIF(trim(p_note), ''), v_expires_at
    )
    RETURNING id INTO v_hotspot_grant_id;
  END IF;

  IF p_access_type IN ('pppoe', 'both') THEN
    SELECT * INTO v_pppoe_package
    FROM public.packages
    WHERE id = p_pppoe_package_id
      AND tenant_id = v_tenant_id
      AND active
      AND kind = 'pppoe';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Select an active PPPoE package for this tenant'
        USING ERRCODE = '22023';
    END IF;
    IF v_pppoe_package.duration_value IS NULL OR v_pppoe_package.duration_value <= 0
      OR v_pppoe_package.duration_unit NOT IN ('minutes', 'hours', 'days', 'weeks', 'months') THEN
      RAISE EXCEPTION 'The PPPoE package must have a valid duration' USING ERRCODE = '22023';
    END IF;
    IF p_router_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.routers r
      WHERE r.id = p_router_id AND r.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Select a router belonging to this tenant' USING ERRCODE = '22023';
    END IF;
    IF p_pppoe_username IS NULL
      OR p_pppoe_username !~ '^[A-Za-z0-9._@-]{3,64}$'
      OR p_pppoe_password IS NULL
      OR p_pppoe_password !~ '^[A-Za-z0-9._@-]{4,64}$' THEN
      RAISE EXCEPTION 'Enter a valid PPPoE username and password' USING ERRCODE = '22023';
    END IF;

    v_expires_at := now() + CASE v_pppoe_package.duration_unit
      WHEN 'minutes' THEN v_pppoe_package.duration_value * interval '1 minute'
      WHEN 'hours' THEN v_pppoe_package.duration_value * interval '1 hour'
      WHEN 'days' THEN v_pppoe_package.duration_value * interval '1 day'
      WHEN 'weeks' THEN v_pppoe_package.duration_value * interval '1 week'
      WHEN 'months' THEN v_pppoe_package.duration_value * interval '30 days'
    END;

    SELECT c.id INTO v_existing_customer_id
    FROM public.staff_internet_grants g
    JOIN public.customers c ON c.id = g.customer_id
    WHERE g.tenant_id = v_tenant_id
      AND g.staff_user_id = p_staff_user_id
      AND g.access_type = 'pppoe'
    ORDER BY g.created_at DESC
    LIMIT 1
    FOR UPDATE OF c;

    IF v_existing_customer_id IS NULL THEN
      INSERT INTO public.customers (
        tenant_id, full_name, phone, customer_type, status, pppoe_username,
        pppoe_password, package_id, router_id, expires_at
      )
      VALUES (
        v_tenant_id, v_staff_name, v_staff_phone, 'pppoe', 'active',
        p_pppoe_username, p_pppoe_password, v_pppoe_package.id, p_router_id, v_expires_at
      )
      RETURNING id INTO v_customer_id;
    ELSE
      v_customer_id := v_existing_customer_id;
      UPDATE public.customers
      SET full_name = v_staff_name,
          phone = v_staff_phone,
          status = 'active',
          pppoe_username = p_pppoe_username,
          pppoe_password = p_pppoe_password,
          package_id = v_pppoe_package.id,
          router_id = p_router_id,
          expires_at = greatest(COALESCE(expires_at, now()), now())
            + (v_expires_at - now())
      WHERE id = v_customer_id;
      SELECT expires_at INTO v_expires_at
      FROM public.customers WHERE id = v_customer_id;
    END IF;

    INSERT INTO public.staff_internet_grants (
      tenant_id, staff_user_id, staff_name, staff_phone, granted_by, access_type, package_id,
      package_name, retail_value, customer_id, pppoe_username, note, expires_at
    )
    VALUES (
      v_tenant_id, p_staff_user_id, v_staff_name, v_staff_phone, p_actor_id, 'pppoe', v_pppoe_package.id,
      v_pppoe_package.name, v_pppoe_package.price, v_customer_id, p_pppoe_username,
      NULLIF(trim(p_note), ''), v_expires_at
    )
    RETURNING id INTO v_pppoe_grant_id;
  END IF;

  RETURN jsonb_build_object(
    'hotspot_grant_id', v_hotspot_grant_id,
    'hotspot_code', v_code,
    'pppoe_grant_id', v_pppoe_grant_id,
    'pppoe_username', CASE WHEN p_access_type IN ('pppoe', 'both') THEN p_pppoe_username END,
    'pppoe_password', CASE WHEN p_access_type IN ('pppoe', 'both') THEN p_pppoe_password END,
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_staff_internet(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_staff_internet(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.generate_due_customer_invoices(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer record;
  v_period_end timestamptz;
  v_invoice_number text;
  v_count integer := 0;
BEGIN
  UPDATE public.customer_invoices
     SET status = 'overdue'
   WHERE status = 'pending'
     AND due_at <= p_now;

  FOR v_customer IN
    SELECT
      c.id,
      c.tenant_id,
      c.package_id,
      c.expires_at,
      pkg.name,
      pkg.price,
      pkg.duration_value,
      pkg.duration_unit
    FROM public.customers AS c
    JOIN public.packages AS pkg
      ON pkg.id = c.package_id
     AND pkg.tenant_id = c.tenant_id
     AND pkg.kind = 'pppoe'
    WHERE c.customer_type = 'pppoe'
      AND c.status = 'active'
      AND c.expires_at IS NOT NULL
      AND c.expires_at <= p_now
      AND pkg.price > 0
      AND pkg.duration_value > 0
      AND pkg.duration_unit IN ('minutes', 'hours', 'days', 'weeks', 'months')
      AND pkg.duration_value <= 2147483647
      AND NOT EXISTS (
        SELECT 1
          FROM public.payments AS payment
         WHERE payment.tenant_id = c.tenant_id
           AND payment.customer_id = c.id
           AND payment.status IN ('pending', 'processing')
      )
      AND NOT EXISTS (
        SELECT 1
          FROM public.staff_internet_grants AS staff_grant
         WHERE staff_grant.tenant_id = c.tenant_id
           AND staff_grant.customer_id = c.id
      )
    ORDER BY c.expires_at, c.id
  LOOP
    v_period_end := v_customer.expires_at + CASE v_customer.duration_unit
      WHEN 'minutes' THEN v_customer.duration_value * interval '1 minute'
      WHEN 'hours' THEN v_customer.duration_value * interval '1 hour'
      WHEN 'days' THEN v_customer.duration_value * interval '1 day'
      WHEN 'weeks' THEN v_customer.duration_value * interval '1 week'
      WHEN 'months' THEN v_customer.duration_value * interval '30 days'
    END;
    v_invoice_number := 'C-' || to_char(p_now AT TIME ZONE 'Africa/Nairobi', 'YYYYMM')
      || '-' || lpad(nextval('public.customer_invoice_number_seq')::text, 8, '0');

    INSERT INTO public.customer_invoices (
      tenant_id, customer_id, package_id, invoice_number, amount, status,
      package_name, service_period_start, service_period_end, duration_value, duration_unit,
      issued_at, due_at
    )
    VALUES (
      v_customer.tenant_id,
      v_customer.id,
      v_customer.package_id,
      v_invoice_number,
      ceil(v_customer.price),
      'pending',
      v_customer.name,
      v_customer.expires_at,
      v_period_end,
      v_customer.duration_value,
      v_customer.duration_unit,
      p_now,
      v_customer.expires_at + interval '3 days'
    )
    ON CONFLICT (customer_id, service_period_start) DO NOTHING;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_due_customer_invoices(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_due_customer_invoices(timestamptz)
  TO service_role;
-- END MIGRATION: supabase/migrations/20261213000000_staff_internet_grants.sql

-- BEGIN MIGRATION: supabase/migrations/20261214000000_legacy_cash_access.sql
ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS legacy_cash_access boolean NOT NULL DEFAULT false;
-- END MIGRATION: supabase/migrations/20261214000000_legacy_cash_access.sql

-- BEGIN MIGRATION: drizzle/migrations/0004_remove_login_throttle.sql
-- Removes the temporary sign-in lockout that blocked an account after five
-- wrong passwords. Failed attempts are still recorded (server-side only) so
-- repeated-failure and new-location security alerts keep working.
DROP FUNCTION IF EXISTS public.check_auth_login_throttle(text, text) CASCADE;
-- END MIGRATION: drizzle/migrations/0004_remove_login_throttle.sql

-- End of generated migration script.
