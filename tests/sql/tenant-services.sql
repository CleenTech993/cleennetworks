-- Tenant service credentials are server-only; commission data is super-admin-only.
DO $$
BEGIN
  INSERT INTO public.tenant_service_secrets (tenant_id, name, ciphertext, last4)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'MPESA_CONSUMER_SECRET', 'v1.iv.ciphertext', 'cret');

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
END $$;

SET ROLE authenticated;
SELECT t.as_user('bbbbbbbb-0000-0000-0000-0000000000a1', 'aal2');
SELECT t.denied('tenant admin cannot read platform commissions', $$SELECT 1 FROM public.platform_commissions$$);
SELECT t.denied('tenant admin cannot change platform commissions', $$UPDATE public.platform_commissions SET status='collected'$$);

SELECT t.as_user('bbbbbbbb-0000-0000-0000-00000000000a', 'aal2');
SELECT t.allowed('super admin can read platform commissions', $$SELECT 1 FROM public.platform_commissions$$);
SELECT t.allowed('super admin can update platform commissions', $$UPDATE public.platform_commissions SET status='collected'$$);
RESET ROLE;

DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM t.results WHERE NOT ok;
  IF bad > 0 THEN RAISE EXCEPTION '% tenant service check(s) failed', bad; END IF;
END $$;

DELETE FROM public.tenant_service_secrets WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
DELETE FROM public.platform_commissions WHERE tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT 'tenant services checks passed';
