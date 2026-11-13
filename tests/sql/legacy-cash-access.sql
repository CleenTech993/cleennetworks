-- Legacy cash access preserves a paid-through expiry without requiring a payment record.
BEGIN;
\ir _harness.sql
\ir _fixtures.sql

INSERT INTO public.vouchers (tenant_id, code, legacy_cash_access, expires_at)
VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'LEGACYCASH1',
    true,
    now() + interval '1 day'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'NORMALCODE1',
    false,
    now() + interval '1 day'
  );

SELECT t.check(
  'legacy cash voucher is marked and has no payment',
  EXISTS (
    SELECT 1 FROM public.vouchers
    WHERE code = 'LEGACYCASH1'
      AND legacy_cash_access
      AND payment_id IS NULL
  )
);
SELECT t.check(
  'ordinary voucher is not marked legacy',
  EXISTS (
    SELECT 1 FROM public.vouchers
    WHERE code = 'NORMALCODE1'
      AND NOT legacy_cash_access
      AND payment_id IS NULL
  )
);

SELECT label FROM t.results WHERE NOT pass;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN
    RAISE EXCEPTION 'legacy cash access checks failed';
  END IF;
END $$;

ROLLBACK;
