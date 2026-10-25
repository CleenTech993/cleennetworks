-- Checks for 20261026000000_payment_provider.sql (run by run.sh after the migrations).
DO $$
DECLARE
  t uuid := gen_random_uuid();
  ok boolean;
BEGIN
  INSERT INTO public.tenants (id, name, slug) VALUES (t, 'Provider Test', 'provider-test');

  -- existing behaviour: new payments default to PayHero
  INSERT INTO public.payments (tenant_id, amount, merchant_request_id) VALUES (t, 10, 'REF1');
  IF (SELECT provider FROM public.payments WHERE merchant_request_id = 'REF1') <> 'payhero' THEN
    RAISE EXCEPTION 'provider should default to payhero';
  END IF;

  -- unknown providers are rejected
  BEGIN
    INSERT INTO public.payments (tenant_id, amount, provider) VALUES (t, 10, 'stripe');
    RAISE EXCEPTION 'unknown provider was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.platform_mpesa_config SET active_provider = 'stripe' WHERE id = 1;
    RAISE EXCEPTION 'unknown active_provider was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- one IntaSend invoice can back only one payment ...
  INSERT INTO public.payments (tenant_id, amount, provider, merchant_request_id) VALUES (t, 10, 'intasend', 'INV1');
  BEGIN
    INSERT INTO public.payments (tenant_id, amount, provider, merchant_request_id) VALUES (t, 10, 'intasend', 'INV1');
    RAISE EXCEPTION 'duplicate intasend invoice was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- ... but the rule does not touch PayHero rows or payments that have no invoice yet
  INSERT INTO public.payments (tenant_id, amount, provider, merchant_request_id) VALUES (t, 10, 'payhero', 'INV1');
  INSERT INTO public.payments (tenant_id, amount, provider) VALUES (t, 10, 'intasend'), (t, 10, 'intasend');

  -- IntaSend is the default gateway: the existing row was switched, and a fresh row defaults to it
  IF EXISTS (SELECT 1 FROM public.platform_mpesa_config WHERE active_provider <> 'intasend') THEN
    RAISE EXCEPTION 'existing platform config should have been switched to intasend';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'platform_mpesa_config' AND column_name = 'active_provider')
     NOT LIKE '%intasend%' THEN
    RAISE EXCEPTION 'platform_mpesa_config.active_provider should default to intasend';
  END IF;

  RAISE NOTICE 'payment provider checks passed';
END $$;
