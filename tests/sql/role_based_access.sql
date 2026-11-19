-- Role-based access test. Run against a THROWAWAY database that has all migrations applied
-- (never production):   psql -v ON_ERROR_STOP=1 -d <scratch_db> -f tests/sql/role_based_access.sql
-- Everything runs in one transaction that is rolled back; any wrong result aborts with a message.
BEGIN;

CREATE FUNCTION public.t_check(label text, actual bigint, expected bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL: % (got %, expected %)', label, actual, expected;
  END IF;
END$$;
-- rows touched by a DML statement run as the current role
CREATE FUNCTION public.t_rows(q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END$$;
-- 1 if the statement is rejected with "insufficient privilege" (RLS / trigger), else 0
CREATE FUNCTION public.t_denied(q text) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 0;
EXCEPTION WHEN insufficient_privilege THEN RETURN 1; END$$;

-- ---- fixtures (as superuser, RLS bypassed) ----
INSERT INTO public.tenants (id, name, slug) VALUES
  ('a0000000-0000-0000-0000-000000000001','T1','t1-test'),
  ('a0000000-0000-0000-0000-000000000002','T2','t2-test');

INSERT INTO auth.users (id, email) VALUES
  ('b0000000-0000-0000-0000-000000000001','admin1@t.test'),
  ('b0000000-0000-0000-0000-000000000002','tech1@t.test'),
  ('b0000000-0000-0000-0000-000000000003','bill1@t.test'),
  ('b0000000-0000-0000-0000-000000000004','supp1@t.test'),
  ('b0000000-0000-0000-0000-000000000005','admin2@t.test'),
  ('b0000000-0000-0000-0000-000000000006','super@t.test');
UPDATE public.profiles SET tenant_id='a0000000-0000-0000-0000-000000000001'
  WHERE id IN ('b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000004');
UPDATE public.profiles SET tenant_id='a0000000-0000-0000-0000-000000000002' WHERE id='b0000000-0000-0000-0000-000000000005';
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('b0000000-0000-0000-0000-000000000001','tenant_admin','a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002','technician','a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000003','billing_agent','a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000004','support_staff','a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000005','tenant_admin','a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000006','super_admin',NULL);

-- one row per table in each tenant (router/payment/customer in T2 to prove isolation)
INSERT INTO public.routers (id, tenant_id, name) VALUES
  ('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','r1'),
  ('c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','r2');
INSERT INTO public.packages (tenant_id, name) VALUES ('a0000000-0000-0000-0000-000000000001','p1');
INSERT INTO public.customers (tenant_id) VALUES ('a0000000-0000-0000-0000-000000000001'),('a0000000-0000-0000-0000-000000000002');
INSERT INTO public.sessions (tenant_id) VALUES ('a0000000-0000-0000-0000-000000000001');
INSERT INTO public.payments (tenant_id, amount) VALUES ('a0000000-0000-0000-0000-000000000001',100),('a0000000-0000-0000-0000-000000000002',100);
INSERT INTO public.support_tickets (tenant_id, subject) VALUES ('a0000000-0000-0000-0000-000000000001','s1');
INSERT INTO public.captive_portals (tenant_id) VALUES ('a0000000-0000-0000-0000-000000000001');
INSERT INTO public.vouchers (tenant_id, code) VALUES ('a0000000-0000-0000-0000-000000000001','CODE1');
INSERT INTO public.settlements (tenant_id, period_start, period_end) VALUES ('a0000000-0000-0000-0000-000000000001', now(), now());
INSERT INTO public.router_metrics (tenant_id, router_id) VALUES ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001');

-- ===== tenant admin (T1): everything in T1, nothing in T2 =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001',true);
SELECT public.t_check('admin routers',(SELECT count(*) FROM routers),1);
SELECT public.t_check('admin customers',(SELECT count(*) FROM customers),1);
SELECT public.t_check('admin payments',(SELECT count(*) FROM payments),1);
SELECT public.t_check('admin vouchers',(SELECT count(*) FROM vouchers),1);
SELECT public.t_check('admin portals',(SELECT count(*) FROM captive_portals),1);
SELECT public.t_check('admin tickets',(SELECT count(*) FROM support_tickets),1);
SELECT public.t_check('admin sessions',(SELECT count(*) FROM sessions),1);
SELECT public.t_check('admin settlements',(SELECT count(*) FROM settlements),1);
SELECT public.t_check('admin metrics',(SELECT count(*) FROM router_metrics),1);
SELECT public.t_check('admin tenant row',(SELECT count(*) FROM tenants),1);
SELECT public.t_check('admin edits own tenant name',public.t_rows($q$UPDATE tenants SET name='T1 renamed'$q$),1);
SELECT public.t_check('admin cannot change commission',public.t_denied($q$UPDATE tenants SET platform_commission_pct=0$q$),1);
SELECT public.t_check('admin cannot change status',public.t_denied($q$UPDATE tenants SET status='suspended'$q$),1);
SELECT public.t_check('admin cannot touch other tenant router',public.t_rows($q$UPDATE routers SET name='x' WHERE id='c0000000-0000-0000-0000-000000000002'$q$),0);
SELECT public.t_check('admin cannot insert into other tenant',public.t_denied($q$INSERT INTO packages (tenant_id,name) VALUES ('a0000000-0000-0000-0000-000000000002','evil')$q$),1);
RESET ROLE;

-- ===== technician =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000002',true);
SELECT public.t_check('tech routers',(SELECT count(*) FROM routers),1);
SELECT public.t_check('tech metrics',(SELECT count(*) FROM router_metrics),1);
SELECT public.t_check('tech customers',(SELECT count(*) FROM customers),1);
SELECT public.t_check('tech sessions',(SELECT count(*) FROM sessions),1);
SELECT public.t_check('tech packages',(SELECT count(*) FROM packages),1);
SELECT public.t_check('tech tickets',(SELECT count(*) FROM support_tickets),1);
SELECT public.t_check('tech NO payments',(SELECT count(*) FROM payments),0);
SELECT public.t_check('tech NO vouchers',(SELECT count(*) FROM vouchers),0);
SELECT public.t_check('tech NO portal',(SELECT count(*) FROM captive_portals),0);
SELECT public.t_check('tech NO settlements',(SELECT count(*) FROM settlements),0);
SELECT public.t_check('tech NO tenant row',(SELECT count(*) FROM tenants),0);
SELECT public.t_check('tech updates customer',public.t_rows($q$UPDATE customers SET status='active'$q$),1);
SELECT public.t_check('tech adds router',public.t_denied($q$INSERT INTO routers (tenant_id,name) VALUES ('a0000000-0000-0000-0000-000000000001','new')$q$),0);
SELECT public.t_check('tech cannot add router to other tenant',public.t_denied($q$INSERT INTO routers (tenant_id,name) VALUES ('a0000000-0000-0000-0000-000000000002','evil')$q$),1);
SELECT public.t_check('tech cannot edit packages',public.t_rows($q$UPDATE packages SET name='x'$q$),0);
SELECT public.t_check('tech cannot add payment',public.t_denied($q$INSERT INTO payments (tenant_id,amount) VALUES ('a0000000-0000-0000-0000-000000000001',1)$q$),1);
SELECT public.t_check('tech cannot edit tenant',public.t_rows($q$UPDATE tenants SET name='x'$q$),0);
RESET ROLE;

-- ===== billing agent =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000003',true);
SELECT public.t_check('bill payments',(SELECT count(*) FROM payments),1);
SELECT public.t_check('bill vouchers',(SELECT count(*) FROM vouchers),1);
SELECT public.t_check('bill customers',(SELECT count(*) FROM customers),1);
SELECT public.t_check('bill packages',(SELECT count(*) FROM packages),1);
SELECT public.t_check('bill settlements',(SELECT count(*) FROM settlements),1);
SELECT public.t_check('bill NO routers (provision token)',(SELECT count(*) FROM routers),0);
SELECT public.t_check('bill NO metrics',(SELECT count(*) FROM router_metrics),0);
SELECT public.t_check('bill NO sessions',(SELECT count(*) FROM sessions),0);
SELECT public.t_check('bill NO tickets',(SELECT count(*) FROM support_tickets),0);
SELECT public.t_check('bill NO portal',(SELECT count(*) FROM captive_portals),0);
SELECT public.t_check('bill NO tenant row',(SELECT count(*) FROM tenants),0);
SELECT public.t_check('bill updates customer',public.t_rows($q$UPDATE customers SET status='active'$q$),1);
SELECT public.t_check('bill adds voucher',public.t_denied($q$INSERT INTO vouchers (tenant_id,code) VALUES ('a0000000-0000-0000-0000-000000000001','CODE2')$q$),0);
SELECT public.t_check('bill cannot edit payments',public.t_rows($q$UPDATE payments SET amount=1$q$),0);
SELECT public.t_check('bill cannot delete payments',public.t_rows($q$DELETE FROM payments$q$),0);
SELECT public.t_check('bill cannot edit packages',public.t_rows($q$UPDATE packages SET name='x'$q$),0);
RESET ROLE;

-- ===== support staff =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000004',true);
SELECT public.t_check('supp customers',(SELECT count(*) FROM customers),1);
SELECT public.t_check('supp sessions',(SELECT count(*) FROM sessions),1);
SELECT public.t_check('supp packages',(SELECT count(*) FROM packages),1);
SELECT public.t_check('supp tickets',(SELECT count(*) FROM support_tickets),1);
SELECT public.t_check('supp NO payments',(SELECT count(*) FROM payments),0);
SELECT public.t_check('supp NO vouchers',(SELECT count(*) FROM vouchers),0);
SELECT public.t_check('supp NO routers',(SELECT count(*) FROM routers),0);
SELECT public.t_check('supp NO tenant row',(SELECT count(*) FROM tenants),0);
SELECT public.t_check('supp updates ticket',public.t_rows($q$UPDATE support_tickets SET status='closed'$q$),1);
SELECT public.t_check('supp cannot edit customers',public.t_rows($q$UPDATE customers SET status='x'$q$),0);
RESET ROLE;

-- ===== other tenant's admin cannot see T1 =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005',true);
SELECT public.t_check('admin2 sees only T2 routers',(SELECT count(*) FROM routers),1);
SELECT public.t_check('admin2 sees no T1 data',(SELECT count(*) FROM routers WHERE tenant_id='a0000000-0000-0000-0000-000000000001'),0);
SELECT public.t_check('admin2 sees no T1 payments',(SELECT count(*) FROM payments WHERE tenant_id='a0000000-0000-0000-0000-000000000001'),0);
RESET ROLE;

-- ===== super admin keeps full access, incl. platform-controlled fields =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000006',true);
SELECT public.t_check('super routers (incl. the one the technician added)',(SELECT count(*) FROM routers),3);
SELECT public.t_check('super payments',(SELECT count(*) FROM payments),2);
SELECT public.t_check('super tenants',(SELECT count(*) FROM tenants),2);
SELECT public.t_check('super sets commission',public.t_rows($q$UPDATE tenants SET platform_commission_pct=7 WHERE slug='t1-test'$q$),1);
RESET ROLE;

-- ===== server-side (service role, no JWT user) is unaffected =====
SET LOCAL ROLE service_role;
SELECT public.t_check('service role sets status',public.t_rows($q$UPDATE tenants SET status='suspended' WHERE slug='t1-test'$q$),1);
RESET ROLE;

DROP FUNCTION public.t_check(text,bigint,bigint);
DROP FUNCTION public.t_rows(text);
DROP FUNCTION public.t_denied(text);
ROLLBACK;
\echo ALL ROLE-ACCESS CHECKS PASSED
