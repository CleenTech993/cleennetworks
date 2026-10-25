-- Role-aware RLS.
--
-- Until now every tenant-scoped table had one `FOR ALL` policy keyed only on profiles.tenant_id,
-- so ANY member of a tenant (technician, support staff, ...) could write ANY row of that tenant
-- straight through the Supabase client, bypassing the role checks done in server functions.
-- That allowed, for example: forging `payments` rows, minting vouchers, changing package prices,
-- and a tenant admin zeroing their own platform_commission_pct.
--
-- New model
--   read   : unchanged (anyone whose profile belongs to the tenant), except vouchers (bearer
--            credentials) which only admins / billing agents may read.
--   write  : by role, taken from the user_roles row for that tenant (the same source the server
--            functions use), never from anything the client sends.
--
--   payments, sessions ........ no client writes at all (service role only)
--   vouchers, packages ........ tenant_admin, billing_agent
--   customers ................. tenant_admin, billing_agent, technician
--   routers ................... tenant_admin, technician
--   captive_portals ........... tenant_admin
--   tenants (own row) ......... tenant_admin, minus identity / billing columns (trigger below)
--   support_tickets ........... unchanged (every member)

-- ---------- helper ----------
-- True when the signed-in user holds one of `_roles` for `_tenant` AND their profile belongs to it.
CREATE OR REPLACE FUNCTION public.can_in_tenant(_tenant uuid, _roles public.app_role[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _tenant IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND _tenant = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
     AND EXISTS (
       SELECT 1 FROM public.user_roles r
       WHERE r.user_id = auth.uid() AND r.tenant_id = _tenant AND r.role = ANY (_roles)
     )
$$;
REVOKE ALL ON FUNCTION public.can_in_tenant(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_in_tenant(uuid, public.app_role[]) TO authenticated;

-- ---------- payments + sessions: service role only for writes ----------
DROP POLICY IF EXISTS "payments tenant access" ON public.payments;
CREATE POLICY "payments tenant read" ON public.payments FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated, anon;

DROP POLICY IF EXISTS "sessions tenant access" ON public.sessions;
CREATE POLICY "sessions tenant read" ON public.sessions FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.sessions FROM authenticated, anon;

-- ---------- vouchers: bearer credentials, admins + billing only (read and write) ----------
DROP POLICY IF EXISTS "vouchers tenant access" ON public.vouchers;
CREATE POLICY "vouchers staff access" ON public.vouchers FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR public.can_in_tenant(tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]))
  WITH CHECK (public.is_super_admin(auth.uid())
         OR public.can_in_tenant(tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));

-- ---------- read-for-members + write-by-role tables ----------
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('packages',        ARRAY['tenant_admin','billing_agent']),
      ('customers',       ARRAY['tenant_admin','billing_agent','technician']),
      ('routers',         ARRAY['tenant_admin','technician']),
      ('captive_portals', ARRAY['tenant_admin'])
    ) AS v(tbl, roles)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || ' tenant access', spec.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()))',
      spec.tbl || ' tenant read', spec.tbl);
    -- permissive policies are OR-ed: reads stay broad (above), writes need one of these roles.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (public.is_super_admin(auth.uid())
                OR public.can_in_tenant(tenant_id, %L::public.app_role[]))
         WITH CHECK (public.is_super_admin(auth.uid())
                OR public.can_in_tenant(tenant_id, %L::public.app_role[]))',
      spec.tbl || ' staff write', spec.tbl, spec.roles, spec.roles);
  END LOOP;
END $$;

-- ---------- tenants ----------
DROP POLICY IF EXISTS "tenants admin update" ON public.tenants;
CREATE POLICY "tenants admin update" ON public.tenants FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR public.can_in_tenant(id, ARRAY['tenant_admin']::public.app_role[]))
  WITH CHECK (public.is_super_admin(auth.uid())
         OR public.can_in_tenant(id, ARRAY['tenant_admin']::public.app_role[]));

-- A tenant admin may edit their business details (name, colours, receiving account, support
-- contacts) but not identity or billing fields. RLS cannot restrict columns per role, so a trigger
-- does. Calls without a JWT subject (service role, migrations, SQL editor) are not affected.
CREATE OR REPLACE FUNCTION public.protect_tenant_columns()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF NEW.id                      IS DISTINCT FROM OLD.id
  OR NEW.slug                    IS DISTINCT FROM OLD.slug
  OR NEW.subdomain               IS DISTINCT FROM OLD.subdomain
  OR NEW.status                  IS DISTINCT FROM OLD.status
  OR NEW.platform_commission_pct IS DISTINCT FROM OLD.platform_commission_pct
  OR NEW.created_at              IS DISTINCT FROM OLD.created_at
  -- legacy per-tenant Daraja credentials; payments now go through the platform gateway
  OR NEW.mpesa_env               IS DISTINCT FROM OLD.mpesa_env
  OR NEW.mpesa_shortcode         IS DISTINCT FROM OLD.mpesa_shortcode
  OR NEW.mpesa_consumer_key      IS DISTINCT FROM OLD.mpesa_consumer_key
  OR NEW.mpesa_consumer_secret   IS DISTINCT FROM OLD.mpesa_consumer_secret
  OR NEW.mpesa_passkey           IS DISTINCT FROM OLD.mpesa_passkey
  THEN
    RAISE EXCEPTION 'Only a super admin can change this tenant field' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_tenant_columns() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS protect_tenant_columns ON public.tenants;
CREATE TRIGGER protect_tenant_columns BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.protect_tenant_columns();
