DO $$
DECLARE
  v_tenant uuid := gen_random_uuid();
  v_invoice uuid := gen_random_uuid();
  v_mismatch_invoice uuid := gen_random_uuid();
  v_status text;
  v_count integer;
  v_now timestamptz := now();
BEGIN
  INSERT INTO public.tenants (id, name, slug)
  VALUES (v_tenant, 'Platform C2B Test', 'platform-c2b-' || substr(v_tenant::text, 1, 8));

  INSERT INTO public.platform_commissions (
    id, tenant_id, period_start, period_end, gross_amount, commission_amount,
    status, invoice_number, payment_reference
  )
  VALUES
    (v_invoice, v_tenant, v_now, v_now + interval '1 month', 1000, 18,
     'pending', 'INV-C2B-TEST-1', 'NGC2BTEST0001'),
    (v_mismatch_invoice, v_tenant, v_now, v_now + interval '1 month', 1000, 18,
     'pending', 'INV-C2B-TEST-2', 'NGC2BTEST0002');

  v_status := public.record_platform_c2b_transaction(
    'QABPLATFORM001', '123456', 'NGC2BTEST0001', 18, v_now
  );
  IF v_status <> 'matched' THEN
    RAISE EXCEPTION 'expected a matching C2B payment, got %', v_status;
  END IF;
  IF (SELECT status FROM public.platform_commissions WHERE id = v_invoice) <> 'collected'
     OR (SELECT mpesa_receipt FROM public.platform_commissions WHERE id = v_invoice)
        <> 'QABPLATFORM001'
     OR (SELECT tenant_mpesa_receipt FROM public.platform_commissions WHERE id = v_invoice)
        <> 'QABPLATFORM001' THEN
    RAISE EXCEPTION 'matched C2B payment did not mark the invoice paid';
  END IF;

  v_status := public.record_platform_c2b_transaction(
    'QABPLATFORM001', '123456', 'NGC2BTEST0001', 18, v_now
  );
  IF v_status <> 'duplicate' THEN
    RAISE EXCEPTION 'expected duplicate callback to be ignored, got %', v_status;
  END IF;
  SELECT count(*) INTO v_count FROM public.platform_mpesa_transactions
  WHERE transaction_id = 'QABPLATFORM001';
  IF v_count <> 1 THEN RAISE EXCEPTION 'duplicate callback created another ledger row'; END IF;

  v_status := public.record_platform_c2b_transaction(
    'QABPLATFORM002', '123456', 'NGC2BTEST0002', 17, v_now
  );
  IF v_status <> 'amount_mismatch' THEN
    RAISE EXCEPTION 'expected amount mismatch, got %', v_status;
  END IF;
  IF (SELECT status FROM public.platform_commissions WHERE id = v_mismatch_invoice) <> 'pending' THEN
    RAISE EXCEPTION 'an amount mismatch incorrectly paid an invoice';
  END IF;

  v_status := public.record_platform_c2b_transaction(
    'QABPLATFORM003', '123456', 'UNKNOWN', 18, v_now
  );
  IF v_status <> 'unmatched' THEN
    RAISE EXCEPTION 'expected unrecognized reference, got %', v_status;
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.record_platform_c2b_transaction(text,text,text,numeric,timestamp with time zone,text,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.record_platform_c2b_transaction(text,text,text,numeric,timestamp with time zone,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'C2B transaction RPC permissions are incorrect';
  END IF;

  RAISE NOTICE 'platform C2B invoice matching checks passed';
END
$$;
