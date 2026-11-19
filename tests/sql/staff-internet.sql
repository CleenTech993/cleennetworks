-- Complimentary staff access must create router credentials without faking a customer payment.
BEGIN;
\ir _harness.sql
\ir _fixtures.sql

INSERT INTO public.routers (id, tenant_id, name)
VALUES (
  '99999999-0000-0000-0000-0000000000a1',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Technician router'
);
INSERT INTO public.packages (
  id, tenant_id, name, kind, price, duration_value, duration_unit, active
)
VALUES
  (
    '88888888-0000-0000-0000-0000000000a1',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Staff hotspot day',
    'hotspot',
    50,
    1,
    'days',
    true
  ),
  (
    '88888888-0000-0000-0000-0000000000a2',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Staff PPPoE month',
    'pppoe',
    2500,
    1,
    'months',
    true
  );

SELECT t.expect(
  'authenticated users cannot call service-only grant function',
  'blocked',
  'authenticated',
  (SELECT id FROM u WHERE label = 'admin'),
  $$SELECT public.grant_staff_internet(
    '11111111-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000002',
    'hotspot',
    '88888888-0000-0000-0000-0000000000a1',
    NULL, NULL, NULL, NULL, NULL
  )$$
);

SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role","aal":"aal2"}', true);
SELECT public.grant_staff_internet(
  '11111111-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  '11111111-0000-0000-0000-000000000002',
  'both',
  '88888888-0000-0000-0000-0000000000a1',
  '88888888-0000-0000-0000-0000000000a2',
  '99999999-0000-0000-0000-0000000000a1',
  'tech.staff',
  'StaffPass123',
  'Field technician allowance'
);
RESET ROLE;

DO $test$
DECLARE
  v_tenant_id constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  staff_id constant uuid := '11111111-0000-0000-0000-000000000002';
  pppoe_id uuid;
BEGIN
  PERFORM t.check('both access types are recorded separately',
    (SELECT count(*) = 2 FROM public.staff_internet_grants
      WHERE tenant_id = v_tenant_id));
  PERFORM t.check('hotspot voucher is usable without a payment',
    EXISTS (
      SELECT 1 FROM public.vouchers v
      JOIN public.staff_internet_grants g ON g.voucher_id = v.id
      WHERE g.staff_user_id = staff_id
        AND v.package_id = '88888888-0000-0000-0000-0000000000a1'
        AND v.status = 'unused'
        AND v.payment_id IS NULL
        AND v.expires_at IS NULL
    ));
  PERFORM t.check('PPPoE account is active and linked to the selected router',
    EXISTS (
      SELECT 1 FROM public.customers c
      JOIN public.staff_internet_grants g ON g.customer_id = c.id
      WHERE g.staff_user_id = staff_id
        AND c.pppoe_username = 'tech.staff'
        AND c.status = 'active'
        AND c.router_id = '99999999-0000-0000-0000-0000000000a1'
        AND c.expires_at > now()
    ));
  PERFORM t.check('no fake customer payment was created',
    NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.tenant_id = v_tenant_id));

  SELECT customer_id INTO pppoe_id
  FROM public.staff_internet_grants
  WHERE staff_user_id = staff_id AND access_type = 'pppoe'
  ORDER BY created_at DESC LIMIT 1;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role","aal":"aal2"}', true);
  PERFORM public.grant_staff_internet(
    '11111111-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    staff_id,
    'pppoe',
    NULL,
    '88888888-0000-0000-0000-0000000000a2',
    '99999999-0000-0000-0000-0000000000a1',
    'tech.staff',
    'StaffPass456',
    'Renew staff access'
  );
  PERFORM t.check('renewal extends the same technician account',
    (SELECT count(*) = 1 FROM public.customers
      WHERE id = pppoe_id AND pppoe_username = 'tech.staff' AND expires_at > now()));
  PERFORM t.check('renewals are retained in the staff benefit ledger',
    (SELECT count(*) = 3 FROM public.staff_internet_grants
      WHERE staff_user_id = staff_id));

  UPDATE public.customers
  SET expires_at = now() - interval '1 minute'
  WHERE id = pppoe_id;
  PERFORM t.check('complimentary PPPoE does not generate a customer invoice',
    public.generate_due_customer_invoices(now()) = 0);
  PERFORM t.check('complimentary PPPoE has no customer invoice',
    NOT EXISTS (SELECT 1 FROM public.customer_invoices WHERE customer_id = pppoe_id));

  BEGIN
    PERFORM public.grant_staff_internet(
      '11111111-0000-0000-0000-000000000002',
      'aaaaaaaa-0000-0000-0000-000000000001',
      staff_id,
      'hotspot',
      '88888888-0000-0000-0000-0000000000a1'
    );
    RAISE EXCEPTION 'non-admin actor granted technician access';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM t.check('complimentary ledger records retail value but no payment',
    (SELECT sum(retail_value) = 5050
      FROM public.staff_internet_grants WHERE staff_user_id = staff_id));
END
$test$;

SELECT label FROM t.results WHERE NOT pass;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN
    RAISE EXCEPTION 'staff internet checks failed';
  END IF;
END $$;

ROLLBACK;
