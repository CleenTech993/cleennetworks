-- Role-aware RLS checks, run through real Postgres RLS (SET ROLE + auth.uid()).
--
-- Easiest: tests/sql/run.sh  (builds a scratch DB from the stub + all migrations and runs every suite).
-- By hand, against a scratch DB that already has _stub_supabase.sql and all migrations applied:
--   psql -d scratch -v ON_ERROR_STOP=1 -f tests/sql/role-aware-rls.sql
--
-- Everything runs inside one transaction that is rolled back, so it leaves no data behind.
-- It exits non-zero (via the final DO block) if any expectation fails.
BEGIN;
\ir _harness.sql
\ir _fixtures.sql

INSERT INTO public.packages (id, tenant_id, name, kind, price, active) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Pkg A', 'hotspot', 100, true);
INSERT INTO public.payments (id, tenant_id, amount, status, phone) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 100, 'success', '254700000001'),
  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 100, 'success', '254700000002');
INSERT INTO public.vouchers (id, tenant_id, code) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'AAAAAAAA');
INSERT INTO public.customers (id, tenant_id, customer_type, pppoe_username, pppoe_password) VALUES
  ('ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'pppoe', 'bob', 'secret1');
INSERT INTO public.routers (id, tenant_id, name) VALUES
  ('99999999-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Router A');
INSERT INTO public.captive_portals (id, tenant_id) VALUES
  ('88888888-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');
INSERT INTO public.sessions (id, tenant_id) VALUES
  ('77777777-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');

-- ---------- expectations ----------
DO $test$
DECLARE
  A  constant text := 'aaaaaaaa-0000-0000-0000-000000000001';
  B  constant text := 'bbbbbbbb-0000-0000-0000-000000000002';
  admin   uuid := (SELECT id FROM u WHERE label='admin');
  tech    uuid := (SELECT id FROM u WHERE label='tech');
  billing uuid := (SELECT id FROM u WHERE label='billing');
  support uuid := (SELECT id FROM u WHERE label='support');
  adminB  uuid := (SELECT id FROM u WHERE label='adminB');
  sup     uuid := (SELECT id FROM u WHERE label='super');
BEGIN
  -- payments: readable by the tenant, writable by nobody except the service role
  PERFORM t.expect('payments: admin can read own',          'ok',      'authenticated', admin,   'SELECT 1 FROM public.payments');
  PERFORM t.expect('payments: tenant B cannot read A rows', 'blocked', 'authenticated', adminB,  format('SELECT 1 FROM public.payments WHERE tenant_id=%L', A));
  FOREACH admin IN ARRAY ARRAY[admin, billing, tech, support] LOOP
    PERFORM t.expect('payments: forge insert blocked ('||(SELECT label FROM u WHERE id=admin)||')', 'blocked', 'authenticated', admin,
      format('INSERT INTO public.payments (tenant_id, amount, status) VALUES (%L, 5000, %L)', A, 'success'));
    PERFORM t.expect('payments: update blocked ('||(SELECT label FROM u WHERE id=admin)||')', 'blocked', 'authenticated', admin,
      'UPDATE public.payments SET amount = 1');
    PERFORM t.expect('payments: delete blocked ('||(SELECT label FROM u WHERE id=admin)||')', 'blocked', 'authenticated', admin,
      'DELETE FROM public.payments');
  END LOOP;
  admin := (SELECT id FROM u WHERE label='admin');
  PERFORM t.expect('payments: super admin cannot forge via client either', 'blocked', 'authenticated', sup,
      format('INSERT INTO public.payments (tenant_id, amount, status) VALUES (%L, 1, %L)', A, 'success'));
  PERFORM t.expect('payments: service role can insert',     'ok',      'service_role',  NULL,
      format('INSERT INTO public.payments (tenant_id, amount, status) VALUES (%L, 100, %L)', A, 'pending'));

  -- sessions: platform-written only
  PERFORM t.expect('sessions: admin can read',    'ok',      'authenticated', admin, 'SELECT 1 FROM public.sessions');
  PERFORM t.expect('sessions: admin insert blocked','blocked','authenticated', admin, format('INSERT INTO public.sessions (tenant_id) VALUES (%L)', A));
  PERFORM t.expect('sessions: admin delete blocked','blocked','authenticated', admin, 'DELETE FROM public.sessions');

  -- vouchers: bearer credentials, so admin + billing only (read and write)
  PERFORM t.expect('vouchers: admin can read',        'ok',      'authenticated', admin,   'SELECT 1 FROM public.vouchers');
  PERFORM t.expect('vouchers: billing can insert',    'ok',      'authenticated', billing, format('INSERT INTO public.vouchers (tenant_id, code) VALUES (%L, %L)', A, 'BBBBBBBB'));
  PERFORM t.expect('vouchers: technician cannot insert','blocked','authenticated', tech,   format('INSERT INTO public.vouchers (tenant_id, code) VALUES (%L, %L)', A, 'CCCCCCCC'));
  PERFORM t.expect('vouchers: support cannot read',   'blocked', 'authenticated', support, 'SELECT 1 FROM public.vouchers');
  PERFORM t.expect('vouchers: technician cannot read','blocked', 'authenticated', tech,    'SELECT 1 FROM public.vouchers');
  PERFORM t.expect('vouchers: tenant B cannot read A','blocked', 'authenticated', adminB,  'SELECT 1 FROM public.vouchers');
  PERFORM t.expect('vouchers: admin cannot insert into tenant B','blocked','authenticated', admin, format('INSERT INTO public.vouchers (tenant_id, code) VALUES (%L, %L)', B, 'DDDDDDDD'));

  -- packages: price controls checkout, so admin + billing write
  PERFORM t.expect('packages: support can read',       'ok',      'authenticated', support, 'SELECT 1 FROM public.packages');
  PERFORM t.expect('packages: billing can update',     'ok',      'authenticated', billing, 'UPDATE public.packages SET price = 120');
  PERFORM t.expect('packages: technician cannot update price','blocked','authenticated', tech, 'UPDATE public.packages SET price = 1');
  PERFORM t.expect('packages: support cannot insert',  'blocked', 'authenticated', support, format('INSERT INTO public.packages (tenant_id, name) VALUES (%L, %L)', A, 'x'));

  -- customers: admin + billing + technician write, support read-only
  PERFORM t.expect('customers: support can read',      'ok',      'authenticated', support, 'SELECT 1 FROM public.customers');
  PERFORM t.expect('customers: technician can insert', 'ok',      'authenticated', tech,    format('INSERT INTO public.customers (tenant_id, customer_type) VALUES (%L, %L)', A, 'pppoe'));
  PERFORM t.expect('customers: support cannot update', 'blocked', 'authenticated', support, 'UPDATE public.customers SET status = $$suspended$$');
  PERFORM t.expect('customers: tenant B cannot update','blocked', 'authenticated', adminB,  'UPDATE public.customers SET status = $$suspended$$');

  -- routers: admin + technician write
  PERFORM t.expect('routers: billing can read',        'ok',      'authenticated', billing, 'SELECT 1 FROM public.routers');
  PERFORM t.expect('routers: technician can update',   'ok',      'authenticated', tech,    'UPDATE public.routers SET name = $$R2$$');
  PERFORM t.expect('routers: billing cannot update',   'blocked', 'authenticated', billing, 'UPDATE public.routers SET name = $$hax$$');
  PERFORM t.expect('routers: support cannot delete',   'blocked', 'authenticated', support, 'DELETE FROM public.routers');

  -- captive portal: admin only
  PERFORM t.expect('portal: admin can update',         'ok',      'authenticated', admin,   'UPDATE public.captive_portals SET welcome_text = $$hi$$');
  PERFORM t.expect('portal: technician cannot update', 'blocked', 'authenticated', tech,    'UPDATE public.captive_portals SET welcome_text = $$hax$$');

  -- tenants: tenant admin edits own business details, never billing/identity fields
  PERFORM t.expect('tenants: admin can edit own details','ok',    'authenticated', admin,   'UPDATE public.tenants SET name = $$Renamed$$, support_phone = $$0700$$, mpesa_paybill = $$123456$$ WHERE slug = $$tenant-a$$');
  PERFORM t.expect('tenants: admin cannot change commission','blocked','authenticated', admin, 'UPDATE public.tenants SET platform_commission_pct = 0 WHERE slug = $$tenant-a$$');
  PERFORM t.expect('tenants: admin cannot change status','blocked','authenticated', admin, 'UPDATE public.tenants SET status = $$suspended$$ WHERE slug = $$tenant-a$$');
  PERFORM t.expect('tenants: admin cannot change slug', 'blocked','authenticated', admin,   'UPDATE public.tenants SET slug = $$stolen$$ WHERE slug = $$tenant-a$$');
  PERFORM t.expect('tenants: admin cannot set legacy mpesa secrets','blocked','authenticated', admin, 'UPDATE public.tenants SET mpesa_passkey = $$x$$ WHERE slug = $$tenant-a$$');
  PERFORM t.expect('tenants: technician cannot edit',   'blocked','authenticated', tech,    'UPDATE public.tenants SET name = $$hax$$ WHERE slug = $$tenant-a$$');
  PERFORM t.expect('tenants: billing cannot edit',      'blocked','authenticated', billing, 'UPDATE public.tenants SET mpesa_paybill = $$999$$ WHERE slug = $$tenant-a$$');
  PERFORM t.expect('tenants: tenant B cannot edit A',   'blocked','authenticated', adminB,  'UPDATE public.tenants SET name = $$hax$$ WHERE slug = $$tenant-a$$');
  PERFORM t.expect('tenants: super admin can change commission','ok','authenticated', sup,  'UPDATE public.tenants SET platform_commission_pct = 7 WHERE slug = $$tenant-a$$');
  PERFORM t.expect('tenants: super admin can suspend',  'ok',     'authenticated', sup,     'UPDATE public.tenants SET status = $$suspended$$ WHERE slug = $$tenant-a$$');
END $test$;

SELECT pass, label, want, got FROM t.results ORDER BY pass, label;

DO $$
DECLARE bad int := (SELECT count(*) FROM t.results WHERE NOT pass);
BEGIN
  IF bad > 0 THEN RAISE EXCEPTION '% of % RLS expectations failed', bad, (SELECT count(*) FROM t.results); END IF;
  RAISE NOTICE 'all % RLS expectations passed', (SELECT count(*) FROM t.results);
END $$;
ROLLBACK;
