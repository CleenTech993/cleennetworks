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
  'new support tickets use normal priority by default',
  EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'
      AND priority = 'normal'
  )
);

SELECT t.expect(
  'support staff can raise a ticket priority',
  'ok',
  'authenticated',
  '11111111-0000-0000-0000-000000000004',
  $$UPDATE public.support_tickets
    SET priority = 'urgent'
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'$$
);
SELECT t.check(
  'urgent ticket priority is persisted',
  EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'
      AND priority = 'urgent'
  )
);
SELECT t.expect(
  'ticket priority rejects unsupported values',
  'blocked',
  'authenticated',
  '11111111-0000-0000-0000-000000000004',
  $$UPDATE public.support_tickets
    SET priority = 'emergency'
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
    RAISE EXCEPTION '% ticket priority check(s) failed: %', v_count, v_failures;
  END IF;
END
$$;

ROLLBACK;
