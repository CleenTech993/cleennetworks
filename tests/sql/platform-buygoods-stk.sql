DO $$
DECLARE
  v_tenant uuid := gen_random_uuid();
  v_invoice uuid := gen_random_uuid();
  v_mismatch_invoice uuid := gen_random_uuid();
  v_status text;
  v_now timestamptz := now();
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_stk_payments'::regclass) THEN
    RAISE EXCEPTION 'platform STK payments must have RLS enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.platform_stk_payments', 'SELECT')
     OR has_table_privilege('authenticated', 'public.platform_stk_payments', 'INSERT')
     OR has_table_privilege('anon', 'public.platform_stk_payments', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.platform_stk_payments', 'SELECT') THEN
    RAISE EXCEPTION 'platform STK payments must be server-only';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.record_platform_stk_transaction(text,text,text,numeric,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.record_platform_stk_transaction(text,text,text,numeric,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'platform STK callback RPC permissions are incorrect';
  END IF;

  INSERT INTO public.tenants (id, name, slug)
  VALUES (v_tenant, 'Platform STK Test', 'platform-stk-' || substr(v_tenant::text, 1, 8));

  INSERT INTO public.platform_commissions (
    id, tenant_id, period_start, period_end, gross_amount, commission_amount,
    status, invoice_number, payment_reference
  )
  VALUES
    (v_invoice, v_tenant, v_now, v_now + interval '1 month', 1000, 18,
     'pending', 'INV-STK-TEST-1', 'NGSTKTEST0001'),
    (v_mismatch_invoice, v_tenant, v_now, v_now + interval '1 month', 1000, 18,
     'pending', 'INV-STK-TEST-2', 'NGSTKTEST0002');

  INSERT INTO public.platform_stk_payments (
    invoice_id, checkout_request_id, phone, amount
  )
  VALUES
    (v_invoice, 'ws_STK_MATCH', '254712345678', 18),
    (v_mismatch_invoice, 'ws_STK_MISMATCH', '254712345678', 18);

  v_status := public.record_platform_stk_transaction(
    'ws_STK_MATCH', 'QABSTKMATCH1', '123456', 18, v_now
  );
  IF v_status <> 'matched'
     OR (SELECT status FROM public.platform_commissions WHERE id = v_invoice) <> 'collected'
     OR (SELECT payment_method FROM public.platform_mpesa_transactions
         WHERE transaction_id = 'QABSTKMATCH1') <> 'stk' THEN
    RAISE EXCEPTION 'successful STK callback did not match and settle the invoice';
  END IF;

  v_status := public.record_platform_stk_transaction(
    'ws_STK_MATCH', 'QABSTKMATCH1', '123456', 18, v_now
  );
  IF v_status <> 'duplicate' THEN
    RAISE EXCEPTION 'duplicate STK callback was not ignored';
  END IF;

  v_status := public.record_platform_stk_transaction(
    'ws_STK_MISMATCH', 'QABSTKMISM1', '123456', 17, v_now
  );
  IF v_status <> 'amount_mismatch'
     OR (SELECT status FROM public.platform_commissions WHERE id = v_mismatch_invoice) <> 'pending' THEN
    RAISE EXCEPTION 'mismatched STK amount incorrectly settled an invoice';
  END IF;
END
$$;
