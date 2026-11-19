\ir _harness.sql
\ir _fixtures.sql

BEGIN;

GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;

INSERT INTO public.customers (id, tenant_id, full_name)
VALUES
  ('cccccccc-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Customer A'),
  ('cccccccc-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'Customer B');

INSERT INTO storage.objects (id, bucket_id, name, owner_id)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000001',
  'customer-documents',
  'aaaaaaaa-0000-0000-0000-000000000001/cccccccc-0000-0000-0000-000000000001/contract.pdf',
  '11111111-0000-0000-0000-000000000001'
);

SELECT t.expect(
  'tenant admin can read customer documents',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000001',
  $$SELECT 1 FROM storage.objects
    WHERE bucket_id='customer-documents'
      AND name LIKE 'aaaaaaaa-0000-0000-0000-000000000001/%'$$
);
SELECT t.expect(
  'support staff can read customer documents',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000004',
  $$SELECT 1 FROM storage.objects WHERE id='eeeeeeee-0000-0000-0000-000000000001'$$
);
SELECT t.expect(
  'super admin can read customer documents',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000006',
  $$SELECT 1 FROM storage.objects WHERE id='eeeeeeee-0000-0000-0000-000000000001'$$
);
SELECT t.expect(
  'billing agent cannot read customer documents',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000003',
  $$SELECT 1 FROM storage.objects WHERE id='eeeeeeee-0000-0000-0000-000000000001'$$
);
SELECT t.expect(
  'another tenant cannot read customer documents',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000005',
  $$SELECT 1 FROM storage.objects WHERE id='eeeeeeee-0000-0000-0000-000000000001'$$
);
SELECT t.expect(
  'technician can upload to own tenant customer',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000002',
  $$INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'customer-documents',
      'aaaaaaaa-0000-0000-0000-000000000001/cccccccc-0000-0000-0000-000000000001/photo.png',
      '11111111-0000-0000-0000-000000000002'
    )$$
);
SELECT t.expect(
  'tenant admin cannot upload to another tenant customer',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000001',
  $$INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'customer-documents',
      'bbbbbbbb-0000-0000-0000-000000000002/cccccccc-0000-0000-0000-000000000002/contract.pdf',
      '11111111-0000-0000-0000-000000000001'
    )$$
);
SELECT t.expect(
  'cannot upload customer documents to an unrelated bucket',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000001',
  $$INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'unrelated-private-bucket',
      'aaaaaaaa-0000-0000-0000-000000000001/cccccccc-0000-0000-0000-000000000001/document.pdf',
      '11111111-0000-0000-0000-000000000001'
    )$$
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
    RAISE EXCEPTION '% customer document permission check(s) failed: %', v_count, v_failures;
  END IF;
END
$$;

ROLLBACK;
