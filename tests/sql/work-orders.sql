\ir _harness.sql
\ir _fixtures.sql

BEGIN;

INSERT INTO public.customers (id, tenant_id, full_name)
VALUES
  ('cccccccc-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Customer A'),
  ('cccccccc-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'Customer B');

INSERT INTO public.support_tickets (id, tenant_id, customer_id, subject)
VALUES
  ('dddddddd-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001',
   'Router offline'),
  ('dddddddd-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001',
   'Slow connection');

INSERT INTO public.work_orders (
  id, tenant_id, customer_id, ticket_id, title, assigned_to, created_by
)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',
  'Check customer router',
  '11111111-0000-0000-0000-000000000002',
  '11111111-0000-0000-0000-000000000001'
);
INSERT INTO public.work_orders (
  id, tenant_id, customer_id, title, assigned_to, created_by
)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000002',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'cccccccc-0000-0000-0000-000000000001',
  'Unassigned follow-up',
  NULL,
  '11111111-0000-0000-0000-000000000001'
);

SELECT t.expect(
  'admin can read tenant work orders',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000001',
  $$SELECT 1 FROM public.work_orders WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001'$$
);
SELECT t.expect(
  'assigned technician can read own work order',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000002',
  $$SELECT 1 FROM public.work_orders WHERE id='eeeeeeee-0000-0000-0000-000000000001'$$
);
SELECT t.expect(
  'technician cannot read unassigned work orders',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000002',
  $$SELECT 1 FROM public.work_orders WHERE id='eeeeeeee-0000-0000-0000-000000000002'$$
);
SELECT t.expect(
  'support staff can read tenant work orders',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000004',
  $$SELECT 1 FROM public.work_orders WHERE id='eeeeeeee-0000-0000-0000-000000000001'$$
);
SELECT t.expect(
  'another tenant cannot read work orders',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000005',
  $$SELECT 1 FROM public.work_orders WHERE id='eeeeeeee-0000-0000-0000-000000000001'$$
);
SELECT t.expect(
  'technician cannot assign a job to another user',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000002',
  $$INSERT INTO public.work_orders (tenant_id, title, assigned_to)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Forged assignment',
            '11111111-0000-0000-0000-000000000001')$$
);
SELECT t.expect(
  'support staff cannot create work orders',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000004',
  $$INSERT INTO public.work_orders (tenant_id, title)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Unauthorized job')$$
);
SELECT t.expect(
  'a ticket can only have one linked work order',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000001',
  $$INSERT INTO public.work_orders (
      tenant_id, customer_id, ticket_id, title
    )
    VALUES (
      'aaaaaaaa-0000-0000-0000-000000000001',
      'cccccccc-0000-0000-0000-000000000001',
      'dddddddd-0000-0000-0000-000000000001',
      'Duplicate ticket job'
    )$$
);
SELECT t.expect(
  'technician can complete assigned work',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000002',
  $$UPDATE public.work_orders SET status='completed'
    WHERE id='eeeeeeee-0000-0000-0000-000000000001'$$
);
SELECT t.check(
  'completing a work order records completion time',
  EXISTS (
    SELECT 1 FROM public.work_orders
    WHERE id='eeeeeeee-0000-0000-0000-000000000001'
      AND completed_at IS NOT NULL
  )
);
SELECT t.expect(
  'technician cannot delete work orders',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000002',
  $$DELETE FROM public.work_orders WHERE id='eeeeeeee-0000-0000-0000-000000000001'$$
);

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM t.results WHERE NOT pass;
  IF v_count > 0 THEN
    RAISE EXCEPTION '% work order permission check(s) failed', v_count;
  END IF;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.work_orders (tenant_id, customer_id, title)
    VALUES (
      'aaaaaaaa-0000-0000-0000-000000000001',
      'cccccccc-0000-0000-0000-000000000002',
      'Cross-tenant customer'
    );
    RAISE EXCEPTION 'cross-tenant customer unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.work_orders (
      tenant_id, customer_id, ticket_id, title
    )
    VALUES (
      'aaaaaaaa-0000-0000-0000-000000000001',
      'cccccccc-0000-0000-0000-000000000001',
      'dddddddd-0000-0000-0000-000000000002',
      'Valid matching ticket'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'matching customer ticket should be accepted: %', SQLERRM;
  END;
END
$$;

ROLLBACK;
