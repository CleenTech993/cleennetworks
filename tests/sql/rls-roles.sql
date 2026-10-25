-- Role-aware RLS + MFA (aal2) checks. Run with run.sh (see header there). Fails (non-zero exit) on any miss.
-- Impersonates Supabase users by setting request.jwt.claims and switching to the `authenticated` role.

-- ---- seed (superuser) -----------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','Tenant One','tenant-one'),
  ('aaaaaaaa-0000-0000-0000-000000000002','Tenant Two','tenant-two');

INSERT INTO auth.users (id, email) VALUES
  ('bbbbbbbb-0000-0000-0000-00000000000a','super@x.test'),
  ('bbbbbbbb-0000-0000-0000-0000000000a1','admin1@x.test'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','billing1@x.test'),
  ('bbbbbbbb-0000-0000-0000-0000000000c1','support1@x.test'),
  ('bbbbbbbb-0000-0000-0000-0000000000d1','tech1@x.test'),
  ('bbbbbbbb-0000-0000-0000-0000000000a2','admin2@x.test');

UPDATE public.profiles SET tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
 WHERE id IN ('bbbbbbbb-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-0000000000b1',
              'bbbbbbbb-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-0000000000d1');
UPDATE public.profiles SET tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002'
 WHERE id = 'bbbbbbbb-0000-0000-0000-0000000000a2';

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('bbbbbbbb-0000-0000-0000-00000000000a','super_admin',NULL),
  ('bbbbbbbb-0000-0000-0000-0000000000a1','tenant_admin','aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','billing_agent','aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-0000000000c1','support_staff','aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-0000000000d1','technician','aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-0000000000a2','tenant_admin','aaaaaaaa-0000-0000-0000-000000000002');

INSERT INTO public.customers (id, tenant_id, full_name) VALUES
  ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','T1 customer'),
  ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','T2 customer');
INSERT INTO public.payments (tenant_id, amount) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 100);
INSERT INTO public.packages (id, tenant_id, name) VALUES ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Pkg');
INSERT INTO public.routers (id, tenant_id, name) VALUES ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','R1');

-- ---- helpers --------------------------------------------------------------------------------
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO authenticated;
CREATE TABLE t.results (label text, ok boolean);
GRANT ALL ON t.results TO authenticated;

CREATE FUNCTION t.as_user(_uid uuid, _aal text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'aal', _aal, 'role', 'authenticated')::text, false) $$;

-- rows affected/returned; -1 when the database refuses the statement outright
CREATE FUNCTION t.try(_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE _sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
EXCEPTION WHEN insufficient_privilege THEN RETURN -1;
END $$;

CREATE FUNCTION t.allowed(_label text, _sql text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO t.results VALUES (_label, t.try(_sql) > 0) $$;
CREATE FUNCTION t.denied(_label text, _sql text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO t.results VALUES (_label, t.try(_sql) <= 0) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

\set admin1  '''bbbbbbbb-0000-0000-0000-0000000000a1'''
\set billing '''bbbbbbbb-0000-0000-0000-0000000000b1'''
\set support '''bbbbbbbb-0000-0000-0000-0000000000c1'''
\set tech    '''bbbbbbbb-0000-0000-0000-0000000000d1'''
\set admin2  '''bbbbbbbb-0000-0000-0000-0000000000a2'''
\set super   '''bbbbbbbb-0000-0000-0000-00000000000a'''
\set T1 '''aaaaaaaa-0000-0000-0000-000000000001'''

-- ---- tenant_admin (aal2): full control of own tenant --------------------------------------
SET ROLE authenticated;
SELECT t.as_user(:admin1, 'aal2');
SELECT t.allowed('admin reads own customers',  $$SELECT 1 FROM public.customers$$);
SELECT t.allowed('admin inserts voucher',      $$INSERT INTO public.vouchers (tenant_id, code) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','ADM1')$$);
SELECT t.allowed('admin edits payout settings',$$UPDATE public.tenants SET mpesa_paybill='123456', bank_name='B' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.allowed('admin inserts router',       $$INSERT INTO public.routers (tenant_id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','R2')$$);
SELECT t.allowed('admin inserts package',      $$INSERT INTO public.packages (tenant_id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','P2')$$);
SELECT t.allowed('admin reads payments',       $$SELECT 1 FROM public.payments$$);
SELECT t.denied ('admin cannot set own commission', $$UPDATE public.tenants SET platform_commission_pct = 0 WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied ('admin cannot change tenant status',$$UPDATE public.tenants SET status = 'active' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied ('admin cannot forge a payment',     $$INSERT INTO public.payments (tenant_id, amount, status) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 1, 'success')$$);
SELECT t.denied ('admin cannot edit a payment',      $$UPDATE public.payments SET status='success'$$);
SELECT t.denied ('admin cannot grant roles',         $$INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES ('bbbbbbbb-0000-0000-0000-0000000000d1','tenant_admin','aaaaaaaa-0000-0000-0000-000000000001')$$);
SELECT t.denied ('admin cannot read other tenant customers', $$SELECT 1 FROM public.customers WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000002'$$);
SELECT t.denied ('admin cannot write into other tenant',     $$INSERT INTO public.customers (tenant_id, full_name) VALUES ('aaaaaaaa-0000-0000-0000-000000000002','x')$$);

-- ---- support_staff -----------------------------------------------------------------------------
SELECT t.as_user(:support, 'aal2');
SELECT t.allowed('support reads customers',  $$SELECT 1 FROM public.customers$$);
SELECT t.allowed('support reads payments',   $$SELECT 1 FROM public.payments$$);
SELECT t.allowed('support edits customer',   $$UPDATE public.customers SET full_name='n' WHERE id='cccccccc-0000-0000-0000-000000000001'$$);
SELECT t.allowed('support opens ticket',     $$INSERT INTO public.support_tickets (tenant_id, subject) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','s')$$);
SELECT t.allowed('support issues reconnect voucher', $$INSERT INTO public.vouchers (tenant_id, code) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','SUP1')$$);
SELECT t.denied ('support cannot edit tenant settings', $$UPDATE public.tenants SET mpesa_paybill='999999' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied ('support cannot forge a payment',      $$INSERT INTO public.payments (tenant_id, amount, status) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 1, 'success')$$);
SELECT t.denied ('support cannot create routers',       $$INSERT INTO public.routers (tenant_id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','evil')$$);
SELECT t.denied ('support cannot delete routers',       $$DELETE FROM public.routers$$);
SELECT t.denied ('support cannot delete customers',     $$DELETE FROM public.customers$$);
SELECT t.denied ('support cannot create packages',      $$INSERT INTO public.packages (tenant_id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','free')$$);
SELECT t.denied ('support cannot edit packages',        $$UPDATE public.packages SET name='free'$$);

-- ---- technician --------------------------------------------------------------------------------
SELECT t.as_user(:tech, 'aal2');
SELECT t.allowed('tech reads routers',   $$SELECT 1 FROM public.routers$$);
SELECT t.allowed('tech adds router',     $$INSERT INTO public.routers (tenant_id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','R3')$$);
SELECT t.denied ('tech cannot read payments',  $$SELECT 1 FROM public.payments$$);
SELECT t.denied ('tech cannot mint vouchers',  $$INSERT INTO public.vouchers (tenant_id, code) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','TECH1')$$);
SELECT t.denied ('tech cannot edit tenant',    $$UPDATE public.tenants SET name='x' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);

-- ---- billing_agent -----------------------------------------------------------------------------
SELECT t.as_user(:billing, 'aal2');
SELECT t.allowed('billing reads payments',  $$SELECT 1 FROM public.payments$$);
SELECT t.allowed('billing edits packages',  $$UPDATE public.packages SET name='P' WHERE id='dddddddd-0000-0000-0000-000000000001'$$);
SELECT t.allowed('billing mints vouchers',  $$INSERT INTO public.vouchers (tenant_id, code) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','BIL1')$$);
SELECT t.denied ('billing cannot delete routers', $$DELETE FROM public.routers$$);
SELECT t.denied ('billing cannot edit tenant',    $$UPDATE public.tenants SET name='x' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);

-- ---- MFA: the same admin on a password-only (aal1) session sees and changes nothing ---------
SELECT t.as_user(:admin1, 'aal1');
SELECT t.denied('aal1 admin cannot read customers',  $$SELECT 1 FROM public.customers$$);
SELECT t.denied('aal1 admin cannot read payments',   $$SELECT 1 FROM public.payments$$);
SELECT t.denied('aal1 admin cannot read routers',    $$SELECT 1 FROM public.routers$$);
SELECT t.denied('aal1 admin cannot insert voucher',  $$INSERT INTO public.vouchers (tenant_id, code) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','NOMFA')$$);
SELECT t.denied('aal1 admin cannot edit settings',   $$UPDATE public.tenants SET mpesa_paybill='1' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);
-- ...but sign-in routing still works before the code is entered
SELECT t.allowed('aal1 admin can still read own role row', $$SELECT 1 FROM public.user_roles WHERE user_id='bbbbbbbb-0000-0000-0000-0000000000a1'$$);
SELECT t.allowed('aal1 admin can still read own profile',  $$SELECT 1 FROM public.profiles WHERE id='bbbbbbbb-0000-0000-0000-0000000000a1'$$);

-- ---- super_admin ---------------------------------------------------------------------------------
SELECT t.as_user(:super, 'aal1');
SELECT t.denied ('aal1 super admin cannot grant roles', $$INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES ('bbbbbbbb-0000-0000-0000-0000000000d1','tenant_admin','aaaaaaaa-0000-0000-0000-000000000001')$$);
SELECT t.denied ('aal1 super admin cannot read tenants', $$SELECT 1 FROM public.tenants$$);
SELECT t.as_user(:super, 'aal2');
SELECT t.allowed('aal2 super admin reads all tenants',   $$SELECT 1 FROM public.tenants$$);
SELECT t.allowed('aal2 super admin reads all payments',  $$SELECT 1 FROM public.payments$$);
SELECT t.allowed('aal2 super admin grants a role',       $$INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES ('bbbbbbbb-0000-0000-0000-0000000000d1','support_staff','aaaaaaaa-0000-0000-0000-000000000001')$$);

-- admin_approve_user refuses an aal1 session, even for a super admin
SELECT t.as_user(:super, 'aal1');
DO $$
BEGIN
  PERFORM public.admin_approve_user('bbbbbbbb-0000-0000-0000-0000000000d1', 'technician', 'aaaaaaaa-0000-0000-0000-000000000001');
  INSERT INTO t.results VALUES ('admin_approve_user rejects aal1 super admin', false);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t.results VALUES ('admin_approve_user rejects aal1 super admin', SQLERRM LIKE '%Two-step%');
END $$;
SELECT t.as_user(:super, 'aal2');
DO $$
BEGIN
  PERFORM public.admin_approve_user('bbbbbbbb-0000-0000-0000-0000000000d1', 'technician', 'aaaaaaaa-0000-0000-0000-000000000001');
  INSERT INTO t.results VALUES ('admin_approve_user works for aal2 super admin', true);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t.results VALUES ('admin_approve_user works for aal2 super admin', false);
END $$;

-- ---- cross-tenant -------------------------------------------------------------------------------
SELECT t.as_user(:admin2, 'aal2');
SELECT t.denied ('other tenant admin cannot read T1 customers', $$SELECT 1 FROM public.customers WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied ('other tenant admin cannot edit T1 settings',  $$UPDATE public.tenants SET name='hijack' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);

-- ---- report -------------------------------------------------------------------------------------
RESET ROLE;
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, label FROM t.results ORDER BY ok, label;
DO $$
DECLARE bad int; total int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT ok), count(*) INTO bad, total FROM t.results;
  RAISE NOTICE '% checks, % failed', total, bad;
  IF bad > 0 THEN RAISE EXCEPTION '% role/MFA check(s) failed', bad; END IF;
END $$;
