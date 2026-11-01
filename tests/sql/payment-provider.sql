-- Checks for the Daraja-only provider behavior after the migrations.
DO $$
DECLARE
  t uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.tenants (id, name, slug) VALUES (t, 'Provider Test', 'provider-test');

  INSERT INTO public.payments (tenant_id, amount, merchant_request_id)
  VALUES (t, 10, 'DARaja-default');
  IF (SELECT provider FROM public.payments WHERE merchant_request_id = 'DARaja-default') <> 'daraja' THEN
    RAISE EXCEPTION 'provider should default to daraja';
  END IF;

  BEGIN
    INSERT INTO public.payments (tenant_id, amount, provider)
    VALUES (t, 10, 'intasend');
    RAISE EXCEPTION 'pending IntaSend payment was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    INSERT INTO public.payments (tenant_id, amount, provider)
    VALUES (t, 10, 'payhero');
    RAISE EXCEPTION 'pending PayHero payment was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO public.payments (tenant_id, amount, provider, status)
  VALUES (t, 10, 'intasend', 'success');

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'platform_mpesa_config'
      AND column_name = 'active_provider'
  ) THEN
    RAISE EXCEPTION 'platform gateway selection should be removed';
  END IF;
  IF to_regclass('public.platform_gateway_secrets') IS NOT NULL THEN
    RAISE EXCEPTION 'platform gateway secrets should be removed';
  END IF;

  RAISE NOTICE 'Daraja-only payment checks passed';
END $$;
