BEGIN;

DO $$
DECLARE
  v_user_id uuid := 'cccccccc-0000-4000-8000-0000000000d1';
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.seed_demo_workspace()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.seed_demo_workspace()', 'EXECUTE') THEN
    RAISE EXCEPTION 'demo workspace seeding permissions are incorrect';
  END IF;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (
    v_user_id,
    'demo-workspace@example.test',
    '{"full_name":"Demo Owner","business_name":"Demo ISP","business_phone":"+254700123456"}'::jsonb
  );
END
$$;

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal1"}',
  false
);
SELECT public.provision_isp_tenant('Demo ISP', '+254700123456', 'Demo Owner');
SELECT public.seed_demo_workspace();
SELECT public.seed_demo_workspace();
DO $$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    UPDATE public.tenants SET is_demo = false
    WHERE id = public.user_tenant_id(auth.uid());
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'tenant admin could change the demo flag'; END IF;
END
$$;
RESET ROLE;

UPDATE public.platform_billing_config
SET commission_tracking_starts_at = now() - interval '90 days'
WHERE id = 1;
SELECT public.generate_monthly_platform_commission_invoices(
  date_trunc('month', now()) + interval '2 months'
);

DO $$
DECLARE
  v_tenant_id uuid;
  v_count integer;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM public.profiles
  WHERE email = 'demo-workspace@example.test';

  IF NOT (SELECT is_demo FROM public.tenants WHERE id = v_tenant_id) THEN
    RAISE EXCEPTION 'demo workspace was not marked as a demo';
  END IF;
  SELECT count(*) INTO v_count FROM public.routers WHERE tenant_id = v_tenant_id;
  IF v_count <> 2 THEN RAISE EXCEPTION 'expected 2 demo routers, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.packages WHERE tenant_id = v_tenant_id;
  IF v_count <> 4 THEN RAISE EXCEPTION 'expected 4 demo packages, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.customers WHERE tenant_id = v_tenant_id;
  IF v_count <> 3 THEN RAISE EXCEPTION 'expected 3 demo customers, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.payments WHERE tenant_id = v_tenant_id;
  IF v_count <> 3 THEN RAISE EXCEPTION 'expected 3 demo payments, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.work_orders WHERE tenant_id = v_tenant_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected 1 demo work order, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.platform_commissions WHERE tenant_id = v_tenant_id;
  IF v_count <> 0 THEN RAISE EXCEPTION 'demo payments generated % platform invoices', v_count; END IF;
END
$$;

ROLLBACK;
SELECT 'demo-workspaces: all expectations passed' AS result;
