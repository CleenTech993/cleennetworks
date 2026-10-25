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
CREATE POLICY "user_roles insert require aal2" ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.is_aal2());
CREATE POLICY "user_roles update require aal2" ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.is_aal2()) WITH CHECK (public.is_aal2());
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
CREATE POLICY "routers select by role" ON public.routers
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
CREATE POLICY "routers insert by role" ON public.routers
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician']::public.app_role[]));
CREATE POLICY "routers update by role" ON public.routers
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician']::public.app_role[]));
CREATE POLICY "routers delete by role" ON public.routers
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician']::public.app_role[]));

-- packages
CREATE POLICY "packages select by role" ON public.packages
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff','end_user']::public.app_role[]));
CREATE POLICY "packages insert by role" ON public.packages
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));
CREATE POLICY "packages update by role" ON public.packages
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));
CREATE POLICY "packages delete by role" ON public.packages
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));

-- customers
CREATE POLICY "customers select by role" ON public.customers
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
CREATE POLICY "customers insert by role" ON public.customers
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent','support_staff']::public.app_role[]));
CREATE POLICY "customers update by role" ON public.customers
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent','support_staff']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent','support_staff']::public.app_role[]));
CREATE POLICY "customers delete by role" ON public.customers
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));

-- vouchers
CREATE POLICY "vouchers select by role" ON public.vouchers
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
CREATE POLICY "vouchers insert by role" ON public.vouchers
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent','support_staff']::public.app_role[]));
CREATE POLICY "vouchers update by role" ON public.vouchers
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));
CREATE POLICY "vouchers delete by role" ON public.vouchers
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));

-- payments
CREATE POLICY "payments select by role" ON public.payments
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent','support_staff']::public.app_role[]));

-- sessions
CREATE POLICY "sessions select by role" ON public.sessions
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));

-- captive_portals
CREATE POLICY "captive_portals select by role" ON public.captive_portals
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
CREATE POLICY "captive_portals insert by role" ON public.captive_portals
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]));
CREATE POLICY "captive_portals update by role" ON public.captive_portals
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]));
CREATE POLICY "captive_portals delete by role" ON public.captive_portals
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]));

-- support_tickets
CREATE POLICY "support_tickets select by role" ON public.support_tickets
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
CREATE POLICY "support_tickets insert by role" ON public.support_tickets
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
CREATE POLICY "support_tickets update by role" ON public.support_tickets
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[])) WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[]));
CREATE POLICY "support_tickets delete by role" ON public.support_tickets
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]));

-- settlements
CREATE POLICY "settlements select by role" ON public.settlements
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','billing_agent']::public.app_role[]));

-- tenants: only a tenant_admin may edit the tenant, and only the columns the Settings page
-- uses. status, slug, subdomain, platform_commission_pct and the platform's own M-Pesa
-- fields are not editable from the browser (a member could previously set the commission to 0).
DROP POLICY IF EXISTS "tenants admin update" ON public.tenants;
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
