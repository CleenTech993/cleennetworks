-- =====================================================================================================
-- NetGrid production catch-up  (generated from supabase/migrations/20261023* onwards - do not edit by hand)
--
-- Run this once in Supabase -> SQL editor. It is SAFE TO RUN MORE THAN ONCE and on any database state:
-- it only adds what is missing and never repeats one-time data changes.
--
-- Before running: supabase/production-status.sql shows which parts are missing.
-- After running:  run production-status.sql again; every row should say true.
-- =====================================================================================================

-- Remember which one-time migrations were ALREADY applied, before anything below changes the database.
SELECT
  set_config('catchup.credentials_done', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'routers' AND column_name = 'legacy_token_auth')::text, false) AS credentials_already_applied,
  set_config('catchup.intasend_default_done', COALESCE((
    SELECT column_default LIKE '%intasend%' FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'platform_mpesa_config' AND column_name = 'active_provider'), false)::text, false) AS intasend_default_already_applied;

-- ===== 20261023000000_lock_profiles_columns.sql =====
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

-- ===== 20261024000000_role_based_access.sql =====
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

-- ===== 20261024120000_router_liveness_check.sql =====
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

-- Scheduling needs the pg_cron extension. If it is not enabled the rest of this script must still run.
DO $catchup$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('router-liveness-check', '*/5 * * * *', 'SELECT public.check_router_liveness()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron is not available (%), so the router liveness check was NOT scheduled. Enable the pg_cron extension in Supabase, then run: SELECT cron.schedule(''router-liveness-check'', ''*/5 * * * *'', ''SELECT public.check_router_liveness()'');', SQLERRM;
END
$catchup$;

-- ===== 20261024130000_pppoe_unique_username.sql =====
-- PPPoE usernames must be unique within a tenant (case-insensitive): the router sync emits one
-- /ppp secret per customer, and two clients sharing a username would overwrite each other.
-- NOTE: if this fails, the tenant already has duplicate PPPoE usernames; rename them first with
--   SELECT tenant_id, lower(pppoe_username), count(*) FROM public.customers
--    WHERE pppoe_username IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_pppoe_username_key
  ON public.customers (tenant_id, lower(pppoe_username))
  WHERE pppoe_username IS NOT NULL;

-- ===== 20261024140000_tv_devices.sql =====
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

-- ===== 20261024150000_portal_theme.sql =====
-- Captive-portal theme chosen by the ISP. The list of themes lives in application code
-- (src/lib/portal-themes.ts); unknown values fall back to 'classic', so adding a theme later
-- needs no migration. Existing portals keep the look they had ('classic').
ALTER TABLE public.captive_portals
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'classic'
  CHECK (theme ~ '^[a-z0-9_-]{1,32}$');

-- ===== 20261025000000_role_aware_rls_and_mfa.sql =====
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

-- ===== 20261025010000_router_credentials.sql =====
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
-- One-time: only when this migration had not been applied (re-running it would switch routers that
-- already use a device token back to the legacy token).
DO $catchup$
BEGIN
  IF current_setting('catchup.credentials_done') <> 'true' THEN
    UPDATE public.routers SET legacy_token_auth = true WHERE provision_token IS NOT NULL;
  END IF;
END
$catchup$;

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

-- ===== 20261025020000_device_management.sql =====
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

-- ===== 20261025030000_pppoe_router_and_sessions.sql =====
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

-- ===== 20261025100000_inventory.sql =====
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

-- ===== 20261026000000_payment_provider.sql =====
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

-- ===== 20261027000000_default_intasend.sql =====
-- IntaSend becomes the default payment gateway.
--   * new installs / missing config row: active_provider defaults to 'intasend'
--   * the existing platform setting is switched to IntaSend
-- Safe to deploy before the IntaSend keys exist: while INTASEND_SECRET_KEY is not set, the server
-- keeps using PayHero (resolveProvider falls back to whichever gateway is configured), and starts
-- using IntaSend as soon as the key is added. Payments already started keep the gateway recorded in
-- payments.provider, so in-flight PayHero payments still complete. To go back, pick PayHero on
-- Super admin -> Platform Payments.
ALTER TABLE public.platform_mpesa_config ALTER COLUMN active_provider SET DEFAULT 'intasend';

-- One-time: only when IntaSend was not already the default (re-running it would override a provider
-- choice made on Super admin -> Platform Payments).
DO $catchup$
BEGIN
  IF current_setting('catchup.intasend_default_done') <> 'true' THEN
    UPDATE public.platform_mpesa_config SET active_provider = 'intasend' WHERE active_provider <> 'intasend';
  END IF;
END
$catchup$;

-- ===== 20261028000000_platform_gateway_secrets.sql =====
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

-- ===== 20261029000000_gateway_secrets_publishable_key.sql =====
-- Allow the IntaSend API (publishable) key to be stored alongside the secret key and webhook challenge.
-- A separate migration, because 20261028000000 may already have been applied and applied migrations are
-- never re-run. The name list is the only thing that changes.
ALTER TABLE public.platform_gateway_secrets
  DROP CONSTRAINT IF EXISTS platform_gateway_secrets_name_check;

ALTER TABLE public.platform_gateway_secrets
  ADD CONSTRAINT platform_gateway_secrets_name_check
  CHECK (name IN ('INTASEND_SECRET_KEY', 'INTASEND_PUBLISHABLE_KEY', 'INTASEND_WEBHOOK_CHALLENGE'));

-- ===== 20261030000000_router_last_sync.sql =====
-- When the router's sync script was last generated for it (the database snapshot it was built from).
-- Shown on the router page so it is obvious whether a router is receiving vouchers and PPPoE users:
-- "never" or "days ago" means customers created since then cannot connect.
ALTER TABLE public.routers ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;

-- ===== done =====
SELECT 'catch-up complete: run supabase/production-status.sql to confirm' AS result;
