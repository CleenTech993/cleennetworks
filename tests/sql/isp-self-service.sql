-- Self-service ISP provisioning and multi-role team administration.
DO $$
DECLARE
  v_new_user uuid := 'cccccccc-0000-4000-8000-0000000000a1';
  v_actor uuid := 'cccccccc-0000-4000-8000-0000000000a2';
  v_member uuid := 'cccccccc-0000-4000-8000-0000000000a3';
  v_non_admin uuid := 'cccccccc-0000-4000-8000-0000000000a4';
  v_tenant uuid := 'dddddddd-0000-4000-8000-0000000000a1';
  n int;
BEGIN
  IF NOT has_function_privilege('authenticated',
      'public.provision_isp_tenant(text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon',
      'public.provision_isp_tenant(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-service provisioning permissions are incorrect';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    (v_new_user, 'new-isp@example.test'),
    (v_actor, 'tenant-admin@example.test'),
    (v_member, 'team-member@example.test'),
    (v_non_admin, 'technician@example.test');
  INSERT INTO public.profiles (id, email) VALUES
    (v_new_user, 'new-isp@example.test'),
    (v_actor, 'tenant-admin@example.test'),
    (v_member, 'team-member@example.test'),
    (v_non_admin, 'technician@example.test')
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  INSERT INTO public.tenants (id, name, slug)
  VALUES (v_tenant, 'Team Test ISP', 'team-test-isp');
  UPDATE public.profiles
  SET tenant_id = v_tenant
  WHERE id IN (v_actor, v_member, v_non_admin);
  INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
    (v_actor, 'tenant_admin', v_tenant),
    (v_member, 'technician', v_tenant),
    (v_non_admin, 'technician', v_tenant);

  IF has_function_privilege('authenticated',
      'public.update_tenant_member_roles(uuid,uuid,public.app_role[])', 'EXECUTE')
     OR has_function_privilege('anon',
      'public.update_tenant_member_roles(uuid,uuid,public.app_role[])', 'EXECUTE')
     OR has_function_privilege('authenticated',
      'public.remove_tenant_member(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'server-only team RPCs are callable by browser roles';
  END IF;
  IF NOT has_function_privilege('service_role',
      'public.update_tenant_member_roles(uuid,uuid,public.app_role[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
      'public.remove_tenant_member(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot call team RPCs';
  END IF;
END
$$;

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}',
  false
);
SELECT public.provision_isp_tenant('New ISP Ltd', '+254700123456', 'New Contact');
SELECT public.provision_isp_tenant('New ISP Ltd', '+254700123456', 'New Contact');
RESET ROLE;

DO $$
DECLARE
  v_new_user uuid := 'cccccccc-0000-4000-8000-0000000000a1';
  v_tenant_id uuid;
  n int;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.profiles WHERE id = v_new_user;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'self-service onboarding did not attach a tenant'; END IF;
  SELECT count(*) INTO n FROM public.tenants WHERE name = 'New ISP Ltd';
  IF n <> 1 THEN RAISE EXCEPTION 'idempotent provisioning created % tenants', n; END IF;
  SELECT count(*) INTO n FROM public.user_roles
  WHERE user_id = v_new_user AND tenant_id = v_tenant_id AND role = 'tenant_admin';
  IF n <> 1 THEN RAISE EXCEPTION 'self-service onboarding did not assign tenant admin'; END IF;
  IF (SELECT phone FROM public.profiles WHERE id = v_new_user) <> '+254700123456' THEN
    RAISE EXCEPTION 'self-service onboarding did not save the contact phone';
  END IF;
END
$$;

SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT public.update_tenant_member_roles(
  'cccccccc-0000-4000-8000-0000000000a2',
  'cccccccc-0000-4000-8000-0000000000a3',
  ARRAY['tenant_admin', 'billing_agent']::public.app_role[]
);
RESET ROLE;

DO $$
DECLARE
  v_tenant uuid := 'dddddddd-0000-4000-8000-0000000000a1';
  v_member uuid := 'cccccccc-0000-4000-8000-0000000000a3';
  v_non_admin uuid := 'cccccccc-0000-4000-8000-0000000000a4';
  n int;
  denied boolean := false;
BEGIN
  SELECT count(*) INTO n FROM public.user_roles
  WHERE user_id = v_member AND tenant_id = v_tenant
    AND role IN ('tenant_admin', 'billing_agent');
  IF n <> 2 THEN RAISE EXCEPTION 'multi-role assignment produced % role rows', n; END IF;

  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    PERFORM public.update_tenant_member_roles(
      v_non_admin, v_member, ARRAY['technician']::public.app_role[]
    );
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  RESET ROLE;
  IF NOT denied THEN RAISE EXCEPTION 'a non-admin actor could update tenant roles'; END IF;
END
$$;

SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT public.remove_tenant_member(
  'cccccccc-0000-4000-8000-0000000000a2',
  'cccccccc-0000-4000-8000-0000000000a3'
);
RESET ROLE;

DO $$
DECLARE
  v_member uuid := 'cccccccc-0000-4000-8000-0000000000a3';
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.user_roles WHERE user_id = v_member;
  IF n <> 0 THEN RAISE EXCEPTION 'removed team member retained % role rows', n; END IF;
  IF (SELECT tenant_id FROM public.profiles WHERE id = v_member) IS NOT NULL THEN
    RAISE EXCEPTION 'removed team member remained attached to the tenant';
  END IF;
END
$$;

RESET ROLE;
SELECT 'isp-self-service: all expectations passed' AS result;
