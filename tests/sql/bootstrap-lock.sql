-- 20261111000000_lock_bootstrap_tenant.sql: a freshly signed-up user must NOT be able to create a workspace and
-- make themselves its admin. Workspaces are granted only through super-admin approval.
DO $$
DECLARE
  uid constant uuid := 'bbbbbbbb-0000-4000-8000-0000000000aa';
  denied boolean;
  n int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (uid, 'newcomer@example.com') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, email) VALUES (uid, 'newcomer@example.com') ON CONFLICT DO NOTHING;

  -- 1) a signed-in user (the role every browser session uses), with no two-step verification yet
  denied := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    PERFORM public.bootstrap_tenant('Free Riders Ltd', 'free-riders', 'Newcomer');
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  RESET ROLE;
  IF NOT denied THEN RAISE EXCEPTION 'a signed-in user could still call bootstrap_tenant'; END IF;

  -- 2) a visitor who is not signed in at all
  denied := false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.bootstrap_tenant('Anon Co', 'anon-co', NULL);
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  RESET ROLE;
  IF NOT denied THEN RAISE EXCEPTION 'an anonymous visitor could still call bootstrap_tenant'; END IF;

  -- 3) nothing was created for the newcomer
  SELECT count(*) INTO n FROM public.user_roles WHERE user_id = uid;
  IF n <> 0 THEN RAISE EXCEPTION 'the newcomer ended up with % role row(s)', n; END IF;
  SELECT count(*) INTO n FROM public.tenants WHERE slug IN ('free-riders', 'anon-co');
  IF n <> 0 THEN RAISE EXCEPTION 'a tenant was created by an unapproved user'; END IF;

  -- 4) the trigger-only functions are not callable by browser roles either
  FOR n IN 1..2 LOOP
    IF has_function_privilege('anon', 'public.inventory_devices_guard()'::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.inventory_devices_guard()'::regprocedure, 'EXECUTE')
       OR has_function_privilege('anon', 'public.stock_movements_apply()'::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.stock_movements_apply()'::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'a trigger-only function is still callable by a browser role';
    END IF;
  END LOOP;

  -- 5) the server (service role) keeps access, so nothing that legitimately needs it breaks
  IF NOT has_function_privilege('service_role', 'public.bootstrap_tenant(text,text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost access to bootstrap_tenant';
  END IF;

  DELETE FROM public.profiles WHERE id = uid;
  DELETE FROM auth.users WHERE id = uid;
  RAISE NOTICE 'bootstrap lock checks passed';
END
$$;
