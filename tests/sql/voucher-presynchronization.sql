\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.tenants (id, name, slug)
VALUES ('71111111-1111-1111-1111-111111111111', 'Voucher Test ISP', 'voucher-presync-test');
INSERT INTO public.routers (id, tenant_id, name, vendor)
VALUES (
  '72222222-2222-2222-2222-222222222222',
  '71111111-1111-1111-1111-111111111111',
  'Voucher Test Router',
  'mikrotik'
);
INSERT INTO public.packages (id, tenant_id, name, kind, price, duration_value, duration_unit)
VALUES (
  '73333333-3333-3333-3333-333333333333',
  '71111111-1111-1111-1111-111111111111',
  'Voucher Test Package',
  'hotspot',
  10,
  3,
  'hours'
);
INSERT INTO public.payments (
  id, tenant_id, package_id, router_id, amount, status, provider
)
VALUES (
  '74444444-4444-4444-4444-444444444444',
  '71111111-1111-1111-1111-111111111111',
  '73333333-3333-3333-3333-333333333333',
  '72222222-2222-2222-2222-222222222222',
  10,
  'processing',
  'daraja'
);

SELECT public.save_voucher_inventory_settings(
  '71111111-1111-1111-1111-111111111111',
  '72222222-2222-2222-2222-222222222222',
  '73333333-3333-3333-3333-333333333333',
  true,
  1,
  1,
  2,
  1
) AS setting_id \gset

UPDATE public.voucher_inventory_settings
SET replenishment_lock_until = now() + interval '3 minutes'
WHERE id = :'setting_id';

SELECT public.insert_presynced_vouchers(
  :'setting_id',
  ARRAY['PRESYNCED001']
);

UPDATE public.vouchers
SET sync_status = 'available', sync_acknowledged_at = now()
WHERE tenant_id = '71111111-1111-1111-1111-111111111111'
  AND code = 'PRESYNCED001';

SELECT *
FROM public.settle_presynced_hotspot_payment(
  '74444444-4444-4444-4444-444444444444',
  'TESTRECEIPT1',
  '{"source":"sql-test"}'::jsonb,
  now() + interval '3 hours'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payments
    WHERE id = '74444444-4444-4444-4444-444444444444'
      AND status = 'success'
      AND voucher_code = 'PRESYNCED001'
      AND fulfillment_status = 'assigned'
      AND expires_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Pre-synced voucher was not assigned without starting expiry';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vouchers
    WHERE code = 'PRESYNCED001'
      AND payment_id = '74444444-4444-4444-4444-444444444444'
      AND sync_status = 'available'
  ) THEN
    RAISE EXCEPTION 'Voucher assignment was not attached to the payment';
  END IF;
END;
$$;

INSERT INTO public.payments (
  id, tenant_id, package_id, router_id, amount, status, provider
)
VALUES (
  '75555555-5555-5555-5555-555555555555',
  '71111111-1111-1111-1111-111111111111',
  '73333333-3333-3333-3333-333333333333',
  '72222222-2222-2222-2222-222222222222',
  10,
  'processing',
  'daraja'
);

UPDATE public.voucher_inventory_settings
SET enabled = false
WHERE id = :'setting_id';

SELECT *
FROM public.settle_presynced_hotspot_payment(
  '75555555-5555-5555-5555-555555555555',
  'TESTRECEIPT2',
  '{"source":"sql-test"}'::jsonb,
  now() + interval '3 hours'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payments
    WHERE id = '75555555-5555-5555-5555-555555555555'
      AND status = 'success'
      AND voucher_code IS NOT NULL
      AND fulfillment_status = 'generated'
      AND expires_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Disabling pre-sync did not generate a voucher after payment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vouchers
    WHERE payment_id = '75555555-5555-5555-5555-555555555555'
      AND tenant_id = '71111111-1111-1111-1111-111111111111'
      AND router_id = '72222222-2222-2222-2222-222222222222'
      AND code = (
        SELECT voucher_code FROM public.payments
        WHERE id = '75555555-5555-5555-5555-555555555555'
      )
      AND sync_status = 'legacy'
      AND expires_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Generated voucher was not linked to the paid payment';
  END IF;
END;
$$;

INSERT INTO public.payments (
  id, tenant_id, package_id, router_id, amount, status, provider
)
VALUES (
  '76666666-6666-6666-8666-666666666666',
  '71111111-1111-1111-1111-111111111111',
  '73333333-3333-3333-3333-333333333333',
  '72222222-2222-2222-2222-222222222222',
  10,
  'processing',
  'daraja'
);

UPDATE public.voucher_inventory_settings
SET enabled = true
WHERE id = :'setting_id';

SELECT *
FROM public.settle_presynced_hotspot_payment(
  '76666666-6666-6666-8666-666666666666',
  'TESTRECEIPT3',
  '{"source":"sql-test"}'::jsonb,
  now() + interval '3 hours'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payments
    WHERE id = '76666666-6666-6666-8666-666666666666'
      AND status = 'success'
      AND voucher_code IS NOT NULL
      AND fulfillment_status = 'generated'
  ) THEN
    RAISE EXCEPTION 'An enabled but empty pre-sync pool did not generate a voucher';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'voucher-presynchronization: all expectations passed';
