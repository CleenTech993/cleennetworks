\ir _harness.sql
\ir _fixtures.sql

BEGIN;

INSERT INTO public.support_tickets (id, tenant_id, subject)
VALUES (
  'dddddddd-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Router offline'
);

SELECT t.check(
  'new support tickets are unassigned by default',
  EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'
      AND assigned_to IS NULL
  )
);

SELECT t.expect(
  'tenant admin can assign a ticket to a tenant technician',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000001',
  $$UPDATE public.support_tickets
    SET assigned_to = '11111111-0000-0000-0000-000000000002'
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'$$
);
SELECT t.check(
  'ticket assignee is saved',
  EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'
      AND assigned_to = '11111111-0000-0000-0000-000000000002'
  )
);

SELECT t.expect(
  'support staff cannot change ticket assignments',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000004',
  $$UPDATE public.support_tickets
    SET assigned_to = '11111111-0000-0000-0000-000000000004'
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'$$
);
SELECT t.expect(
  'tenant admin cannot assign a ticket to another tenant',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000001',
  $$UPDATE public.support_tickets
    SET assigned_to = '11111111-0000-0000-0000-000000000005'
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'$$
);
SELECT t.expect(
  'tenant admin cannot assign a ticket to billing-only staff',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000001',
  $$UPDATE public.support_tickets
    SET assigned_to = '11111111-0000-0000-0000-000000000003'
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'$$
);
SELECT t.expect(
  'tenant admin can unassign a ticket',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000001',
  $$UPDATE public.support_tickets
    SET assigned_to = NULL
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'$$
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
    RAISE EXCEPTION '% ticket assignment check(s) failed: %', v_count, v_failures;
  END IF;
END
$$;

ROLLBACK;
