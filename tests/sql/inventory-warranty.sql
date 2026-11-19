\ir _harness.sql
\ir _fixtures.sql

GRANT SELECT ON public.inventory_devices TO authenticated;

BEGIN;

INSERT INTO public.inventory_devices (id, tenant_id, category, name)
VALUES
  ('f0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'ont', 'Customer ONT'),
  ('f0000000-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'ont', 'Other tenant ONT');

SELECT t.expect(
  'technician can record device warranty expiry',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000002',
  $$UPDATE public.inventory_devices
    SET warranty_expires_on = '2027-01-31'
    WHERE id = 'f0000000-0000-0000-0000-000000000001'$$
);
SELECT t.check(
  'authenticated role can update the warranty column',
  has_column_privilege(
    'authenticated',
    'public.inventory_devices',
    'warranty_expires_on',
    'UPDATE'
  )
);
SELECT t.check(
  'warranty expiry is persisted',
  EXISTS (
    SELECT 1 FROM public.inventory_devices
    WHERE id = 'f0000000-0000-0000-0000-000000000001'
      AND warranty_expires_on = '2027-01-31'
  )
);
SELECT t.expect(
  'technician cannot edit another tenant device warranty',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000002',
  $$UPDATE public.inventory_devices
    SET warranty_expires_on = '2027-01-31'
    WHERE id = 'f0000000-0000-0000-0000-000000000002'$$
);

DO $$
DECLARE
  v_count integer;
  v_failures text;
BEGIN
  SELECT count(*) INTO v_count FROM t.results WHERE NOT pass;
  IF v_count > 0 THEN
    SELECT string_agg(label || ': ' || got, '; ')
      INTO v_failures
      FROM t.results
      WHERE NOT pass;
    RAISE EXCEPTION '% inventory warranty check(s) failed: %', v_count, v_failures;
  END IF;
END
$$;

ROLLBACK;
