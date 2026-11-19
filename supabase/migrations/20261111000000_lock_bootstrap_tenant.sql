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
