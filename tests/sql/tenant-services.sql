-- Tenant service credentials are server-only; commission data is super-admin-only.
DO $$
BEGIN
  INSERT INTO public.tenant_service_secrets (tenant_id, name, ciphertext, last4)
  VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', 'MPESA_CONSUMER_SECRET', 'v1.iv.ciphertext', 'cret'),
    ('aaaaaaaa-0000-0000-0000-000000000001', 'MPESA_MERCHANT_TYPE', 'v1.iv.ciphertext', 'oods');

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tenant_service_secrets'::regclass) THEN
    RAISE EXCEPTION 'tenant service secrets must have RLS enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.tenant_service_secrets', 'SELECT')
     OR has_table_privilege('authenticated', 'public.tenant_service_secrets', 'INSERT')
     OR has_table_privilege('anon', 'public.tenant_service_secrets', 'SELECT') THEN
    RAISE EXCEPTION 'browser roles must not have tenant secret table privileges';
  END IF;

  INSERT INTO public.platform_commissions
    (tenant_id, period_start, period_end, gross_amount, commission_amount)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-01', '2026-10-31', 1000, 50);

  INSERT INTO public.direct_mpesa_transactions
    (id, tenant_id, shortcode, transaction_id, transaction_time, amount, raw_payload)
  VALUES (
    'ffffffff-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '123456',
    'QAB123XYZ',
    '2026-10-24T10:00:00Z',
    500,
    '{"TransID":"QAB123XYZ"}'
  );

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.direct_mpesa_transactions'::regclass) THEN
    RAISE EXCEPTION 'direct M-Pesa transactions must have RLS enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.direct_mpesa_transactions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.direct_mpesa_transactions', 'UPDATE')
     OR has_table_privilege('anon', 'public.direct_mpesa_transactions', 'SELECT')
     OR has_function_privilege(
       'authenticated',
       'public.approve_direct_mpesa_transaction(uuid,uuid,uuid,uuid,timestamptz,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'browser roles must not write or approve direct M-Pesa transactions';
  END IF;
END $$;

SET ROLE authenticated;
SELECT t.as_user('bbbbbbbb-0000-0000-0000-0000000000a1', 'aal2');
SELECT t.denied('tenant admin cannot read platform commissions', $$SELECT 1 FROM public.platform_commissions$$);
SELECT t.denied('tenant admin cannot change platform commissions', $$UPDATE public.platform_commissions SET status='collected'$$);

SELECT t.as_user('bbbbbbbb-0000-0000-0000-00000000000a', 'aal2');
SELECT t.allowed('super admin can read platform commissions', $$SELECT 1 FROM public.platform_commissions$$);
SELECT t.allowed('super admin can update platform commissions', $$UPDATE public.platform_commissions SET status='collected'$$);

SELECT t.as_user('bbbbbbbb-0000-0000-0000-0000000000a1', 'aal2');
SELECT t.allowed(
  'tenant admin can review own direct M-Pesa transactions',
  $$SELECT 1 FROM public.direct_mpesa_transactions WHERE transaction_id='QAB123XYZ'$$
);
SELECT t.denied(
  'tenant admin cannot change captured direct M-Pesa transactions',
  $$UPDATE public.direct_mpesa_transactions SET status='approved'$$
);
RESET ROLE;

UPDATE public.packages
SET kind = 'pppoe', active = true, price = 500, duration_value = 1, duration_unit = 'hours'
WHERE id = 'dddddddd-0000-0000-0000-000000000001';
UPDATE public.customers
SET customer_type = 'pppoe', pppoe_username = 'alice', package_id = 'dddddddd-0000-0000-0000-000000000001'
WHERE id = 'cccccccc-0000-0000-0000-000000000001';

SET ROLE service_role;
SELECT public.approve_direct_mpesa_transaction(
  'ffffffff-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',
  now() + interval '1 hour',
  'bbbbbbbb-0000-0000-0000-0000000000a1'
);
RESET ROLE;

DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM t.results WHERE NOT ok;
  IF bad > 0 THEN RAISE EXCEPTION '% tenant service check(s) failed', bad; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.direct_mpesa_transactions
    WHERE id = 'ffffffff-0000-0000-0000-000000000001'
      AND status = 'approved'
      AND customer_id = 'cccccccc-0000-0000-0000-000000000001'
      AND payment_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'approved C2B transaction was not linked to its PPPoE account';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payments
    WHERE mpesa_receipt = 'QAB123XYZ'
      AND tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      AND customer_id = 'cccccccc-0000-0000-0000-000000000001'
      AND amount = 500
      AND status = 'success'
  ) THEN
    RAISE EXCEPTION 'approved C2B transaction did not create a successful payment record';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = 'cccccccc-0000-0000-0000-000000000001'
      AND status = 'active'
      AND expires_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'approved C2B transaction did not renew PPPoE access';
  END IF;
END $$;

DELETE FROM public.tenant_service_secrets WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
DELETE FROM public.platform_commissions WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';

DO $$
DECLARE
  v_result record;
  i integer;
  v_email_hash text := repeat('a', 64);
  v_ip_hash text := repeat('b', 64);
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.auth_login_attempts'::regclass) THEN
    RAISE EXCEPTION 'login attempts must have RLS enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.auth_login_attempts', 'SELECT')
     OR has_table_privilege('anon', 'public.auth_login_attempts', 'SELECT')
     OR has_function_privilege('authenticated', 'public.record_auth_login_attempt(text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.record_auth_login_attempt(text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'login attempt storage must be server-only';
  END IF;
  IF to_regprocedure('public.check_auth_login_throttle(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'the sign-in lockout must not exist';
  END IF;

  FOR i IN 1..4 LOOP
    SELECT * INTO v_result
      FROM public.record_auth_login_attempt(v_email_hash, v_ip_hash, false);
    IF v_result.should_alert THEN RAISE EXCEPTION 'early failed-login alert'; END IF;
  END LOOP;

  SELECT * INTO v_result
    FROM public.record_auth_login_attempt(v_email_hash, v_ip_hash, false);
  IF NOT v_result.should_alert OR v_result.event_type <> 'repeated_failed_logins' THEN
    RAISE EXCEPTION 'fifth failed login must raise a security alert';
  END IF;

  PERFORM public.record_auth_login_attempt(v_email_hash, v_ip_hash, true);

  SELECT * INTO v_result
    FROM public.record_auth_login_attempt(v_email_hash, repeat('c', 64), true);
  IF NOT v_result.should_alert OR v_result.event_type <> 'new_login_location' THEN
    RAISE EXCEPTION 'known account sign-in from a new IP must raise an alert';
  END IF;
END $$;

SELECT 'tenant services checks passed';
