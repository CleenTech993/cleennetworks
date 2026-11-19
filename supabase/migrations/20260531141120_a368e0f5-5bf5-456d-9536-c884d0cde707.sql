
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
