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
