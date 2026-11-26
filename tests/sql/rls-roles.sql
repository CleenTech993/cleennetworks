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

INSERT INTO public.mood_boost_settings (tenant_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002');
INSERT INTO public.mood_boost_topics (
  id, country_code, language, topic, source, source_reference, status
) VALUES (
  'f0000000-0000-0000-0000-000000000001','KE','en','Local public technology event',
  'Public news source','https://example.test/technology-event','pending'
);
INSERT INTO public.mood_boost_content (
  id, country_code, language, category, caption, moderation_status, published_at
) VALUES
  ('f0000000-0000-0000-0000-000000000011','KE','en','isp_life','Approved original test caption','approved',now()),
  ('f0000000-0000-0000-0000-000000000012','KE','en','isp_life','Pending test caption','pending',NULL);

INSERT INTO public.customers (id, tenant_id, full_name) VALUES
  ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','T1 customer'),
  ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','T2 customer');
-- These admins have MFA enrolled: their password-only (aal1) sessions must be denied
-- until they finish the second step. is_aal2() keys off verified factors in auth.mfa_factors.
INSERT INTO auth.mfa_factors (user_id, status) VALUES
  ('bbbbbbbb-0000-0000-0000-0000000000a1','verified'),
  ('bbbbbbbb-0000-0000-0000-00000000000a','verified');
INSERT INTO public.payments (tenant_id, amount) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 100);
INSERT INTO public.payments (tenant_id, customer_id, amount, status, created_at) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',200,'success',now()),
  ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',25,'failed',now()),
  ('aaaaaaaa-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000002',300,'success',now());
INSERT INTO public.tenant_operating_costs (tenant_id, category, amount, effective_month) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','Upstream bandwidth', 1000, date_trunc('month', current_date)::date),
  ('aaaaaaaa-0000-0000-0000-000000000002','Power', 200, date_trunc('month', current_date)::date);
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
SELECT t.allowed('admin edits tenant labels',   $$UPDATE public.tenants SET ui_labels='{"pppoe":"Broadband"}' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.allowed('admin registers custom domain', $$INSERT INTO public.tenant_domains (tenant_id, purpose, domain) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','hotspot','wifi.tenant-one.example')$$);
SELECT t.allowed('user edits own preferences',    $$UPDATE public.profiles SET preferences='{"theme":"dark"}' WHERE id='bbbbbbbb-0000-0000-0000-0000000000a1'$$);
SELECT t.allowed('admin reads own Mood Boost settings', $$SELECT 1 FROM public.mood_boost_settings WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied('admin cannot read another tenant Mood Boost settings', $$SELECT 1 FROM public.mood_boost_settings WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000002'$$);
SELECT t.allowed('admin updates own Mood Boost settings', $$UPDATE public.mood_boost_settings SET country_code='TZ' WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied('tenant admin cannot change Mood Boost settings for another tenant', $$UPDATE public.mood_boost_settings SET enabled=false WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000002'$$);
SELECT t.allowed('admin reads only approved Mood Boost content', $$SELECT 1 FROM public.mood_boost_content WHERE id='f0000000-0000-0000-0000-000000000011'$$);
SELECT t.denied('tenant admin cannot read pending Mood Boost content', $$SELECT 1 FROM public.mood_boost_content WHERE id='f0000000-0000-0000-0000-000000000012'$$);
SELECT t.allowed('admin reads own operating costs', $$SELECT 1 FROM public.tenant_operating_costs WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied('admin cannot read another tenant operating costs', $$SELECT 1 FROM public.tenant_operating_costs WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000002'$$);
SELECT t.allowed('admin can add own operating cost', $$INSERT INTO public.tenant_operating_costs (tenant_id, category, amount, effective_month) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','Staff',500,date_trunc('month',current_date)::date)$$);
SELECT t.denied('admin cannot add operating cost for another tenant', $$INSERT INTO public.tenant_operating_costs (tenant_id, category, amount, effective_month) VALUES ('aaaaaaaa-0000-0000-0000-000000000002','Staff',500,date_trunc('month',current_date)::date)$$);
SELECT t.allowed('admin gets own monthly revenue aggregate', $$SELECT 1 FROM public.tenant_revenue_by_month('aaaaaaaa-0000-0000-0000-000000000001',12)$$);
SELECT t.denied('admin monthly revenue aggregate hides another tenant', $$SELECT 1 FROM public.tenant_revenue_by_month('aaaaaaaa-0000-0000-0000-000000000002',12)$$);
SELECT t.allowed('admin gets own failed payment counts', $$SELECT 1 FROM public.tenant_failed_payment_counts('aaaaaaaa-0000-0000-0000-000000000001',now() - interval '30 days') WHERE customer_id='cccccccc-0000-0000-0000-000000000001' AND unsuccessful_payment_count=1$$);
SELECT t.denied('admin failed payment counts hide another tenant', $$SELECT 1 FROM public.tenant_failed_payment_counts('aaaaaaaa-0000-0000-0000-000000000002',now() - interval '30 days')$$);
SELECT t.denied('tenant admin cannot manage curated Mood Boost topics', $$SELECT 1 FROM public.mood_boost_topics$$);
SELECT t.allowed('admin records own Mood Boost feedback', $$INSERT INTO public.mood_boost_feedback (tenant_id,user_id,content_id,feedback_type) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-000000000011','like')$$);
SELECT t.allowed('admin records own Mood Boost history', $$INSERT INTO public.mood_boost_history (tenant_id,user_id,content_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-000000000011')$$);
SELECT t.allowed('admin saves own hidden Mood Boost categories', $$INSERT INTO public.mood_boost_user_preferences (tenant_id,user_id,hidden_categories) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000a1',ARRAY['mpesa_moments'])$$);
SELECT t.denied('admin cannot forge another user Mood Boost feedback', $$INSERT INTO public.mood_boost_feedback (tenant_id,user_id,content_id,feedback_type) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000d1','f0000000-0000-0000-0000-000000000011','like')$$);
SELECT t.allowed('admin inserts router',       $$INSERT INTO public.routers (tenant_id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','R2')$$);
SELECT t.allowed('admin inserts package',      $$INSERT INTO public.packages (tenant_id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','P2')$$);
SELECT t.allowed('admin creates active PPPoE account', $$INSERT INTO public.customers (tenant_id, customer_type, pppoe_username, status) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','pppoe','admin-pppoe','active')$$);
SELECT t.allowed('admin creates suspended PPPoE account for technician check', $$INSERT INTO public.customers (id, tenant_id, customer_type, pppoe_username, status) VALUES ('cccccccc-0000-0000-0000-000000000011','aaaaaaaa-0000-0000-0000-000000000001','pppoe','tech-pppoe','suspended')$$);
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
INSERT INTO t.results VALUES ('role helpers return caller support role', public.has_role(auth.uid(), 'support_staff'));
INSERT INTO t.results VALUES ('role helpers hide other platform roles', NOT public.has_role(:admin1, 'tenant_admin'));
INSERT INTO t.results VALUES ('super-admin helper hides another user', NOT public.is_super_admin(:super));
INSERT INTO t.results VALUES ('tenant-role helper hides other workspace roles', NOT public.has_tenant_role(:admin2, 'aaaaaaaa-0000-0000-0000-000000000002', ARRAY['tenant_admin']::public.app_role[]));
SELECT t.allowed('support reads customers',  $$SELECT 1 FROM public.customers$$);
SELECT t.denied('support cannot read operating costs', $$SELECT 1 FROM public.tenant_operating_costs$$);
SELECT t.denied('support cannot read revenue aggregates', $$SELECT 1 FROM public.tenant_revenue_by_month('aaaaaaaa-0000-0000-0000-000000000001',12)$$);
SELECT t.allowed('support reads tenant Mood Boost settings', $$SELECT 1 FROM public.mood_boost_settings WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied('support cannot read another user Mood Boost feedback', $$SELECT 1 FROM public.mood_boost_feedback WHERE user_id='bbbbbbbb-0000-0000-0000-0000000000a1'$$);
SELECT t.denied('support cannot read another user Mood Boost preferences', $$SELECT 1 FROM public.mood_boost_user_preferences WHERE user_id='bbbbbbbb-0000-0000-0000-0000000000a1'$$);
SELECT t.allowed('support reads payments',   $$SELECT 1 FROM public.payments$$);
SELECT t.allowed('support edits customer',   $$UPDATE public.customers SET full_name='n' WHERE id='cccccccc-0000-0000-0000-000000000001'$$);
SELECT t.allowed('support opens ticket',     $$INSERT INTO public.support_tickets (tenant_id, subject) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','s')$$);
SELECT t.allowed('support issues reconnect voucher', $$INSERT INTO public.vouchers (tenant_id, code) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','SUP1')$$);
SELECT t.denied('support cannot create active PPPoE account', $$INSERT INTO public.customers (tenant_id, customer_type, pppoe_username, status) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','pppoe','support-pppoe','active')$$);
SELECT t.denied ('support cannot edit tenant settings', $$UPDATE public.tenants SET mpesa_paybill='999999' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied ('support cannot edit tenant labels',   $$UPDATE public.tenants SET ui_labels='{"pppoe":"Other"}' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied ('support cannot register custom domain', $$INSERT INTO public.tenant_domains (tenant_id, purpose, domain) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','console','console.tenant-one.example')$$);
SELECT t.denied ('support cannot forge a payment',      $$INSERT INTO public.payments (tenant_id, amount, status) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 1, 'success')$$);
SELECT t.denied ('support cannot create routers',       $$INSERT INTO public.routers (tenant_id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','evil')$$);
SELECT t.denied ('support cannot delete routers',       $$DELETE FROM public.routers$$);
SELECT t.denied ('support cannot delete customers',     $$DELETE FROM public.customers$$);
SELECT t.denied ('support cannot create packages',      $$INSERT INTO public.packages (tenant_id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','free')$$);
SELECT t.denied ('support cannot edit packages',        $$UPDATE public.packages SET name='free'$$);

-- ---- technician --------------------------------------------------------------------------------
SELECT t.as_user(:tech, 'aal2');
SELECT t.allowed('tech reads routers',   $$SELECT 1 FROM public.routers$$);
SELECT t.denied('tech cannot read operating costs', $$SELECT 1 FROM public.tenant_operating_costs$$);
SELECT t.denied('tech cannot read revenue aggregates', $$SELECT 1 FROM public.tenant_revenue_by_month('aaaaaaaa-0000-0000-0000-000000000001',12)$$);
SELECT t.allowed('tech reads tenant Mood Boost settings', $$SELECT 1 FROM public.mood_boost_settings WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied('tech cannot update tenant Mood Boost settings', $$UPDATE public.mood_boost_settings SET enabled=false WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.allowed('tech adds router',     $$INSERT INTO public.routers (tenant_id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','R3')$$);
SELECT t.denied ('tech cannot read payments',  $$SELECT 1 FROM public.payments$$);
SELECT t.denied ('tech cannot mint vouchers',  $$INSERT INTO public.vouchers (tenant_id, code) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','TECH1')$$);
SELECT t.denied ('tech cannot edit tenant',    $$UPDATE public.tenants SET name='x' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied ('tech cannot create active PPPoE account', $$INSERT INTO public.customers (tenant_id, customer_type, pppoe_username, status) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','pppoe','tech-free','active')$$);
SELECT t.denied ('tech cannot activate PPPoE account without payment', $$UPDATE public.customers SET status='active' WHERE id='cccccccc-0000-0000-0000-000000000011'$$);
SELECT t.denied ('tech cannot extend PPPoE expiry without payment', $$UPDATE public.customers SET expires_at=now() + interval '30 days' WHERE id='cccccccc-0000-0000-0000-000000000011'$$);

-- ---- billing_agent -----------------------------------------------------------------------------
SELECT t.as_user(:billing, 'aal2');
SELECT t.allowed('billing reads payments',  $$SELECT 1 FROM public.payments$$);
SELECT t.allowed('billing reads own operating costs', $$SELECT 1 FROM public.tenant_operating_costs WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.allowed('billing can add own operating cost', $$INSERT INTO public.tenant_operating_costs (tenant_id, category, amount, effective_month) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','Transport',80,date_trunc('month',current_date)::date)$$);
SELECT t.allowed('billing reads monthly revenue aggregate', $$SELECT 1 FROM public.tenant_revenue_by_month('aaaaaaaa-0000-0000-0000-000000000001',12)$$);
SELECT t.allowed('billing edits packages',  $$UPDATE public.packages SET name='P' WHERE id='dddddddd-0000-0000-0000-000000000001'$$);
SELECT t.allowed('billing mints vouchers',  $$INSERT INTO public.vouchers (tenant_id, code) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','BIL1')$$);
SELECT t.allowed('billing creates suspended PPPoE account', $$INSERT INTO public.customers (id, tenant_id, customer_type, pppoe_username, status) VALUES ('cccccccc-0000-0000-0000-000000000010','aaaaaaaa-0000-0000-0000-000000000001','pppoe','billing-pppoe','suspended')$$);
SELECT t.denied('billing cannot activate PPPoE account without payment', $$UPDATE public.customers SET status='active' WHERE id='cccccccc-0000-0000-0000-000000000010'$$);
SELECT t.denied('billing cannot extend PPPoE expiry without payment', $$UPDATE public.customers SET expires_at=now() + interval '30 days' WHERE id='cccccccc-0000-0000-0000-000000000010'$$);
SELECT t.denied('billing cannot create active PPPoE account', $$INSERT INTO public.customers (tenant_id, customer_type, pppoe_username, status) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','pppoe','billing-free','active')$$);
SELECT t.denied ('billing cannot delete routers', $$DELETE FROM public.routers$$);
SELECT t.denied ('billing cannot edit tenant',    $$UPDATE public.tenants SET name='x' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);

-- ---- MFA: the same admin on a password-only (aal1) session sees and changes nothing ---------
SELECT t.as_user(:admin1, 'aal1');
SELECT t.denied('aal1 admin cannot read customers',  $$SELECT 1 FROM public.customers$$);
SELECT t.denied('aal1 admin cannot read payments',   $$SELECT 1 FROM public.payments$$);
SELECT t.denied('aal1 admin cannot read routers',    $$SELECT 1 FROM public.routers$$);
SELECT t.denied('aal1 admin cannot read Mood Boost settings', $$SELECT 1 FROM public.mood_boost_settings WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
SELECT t.denied('aal1 admin cannot read operating costs', $$SELECT 1 FROM public.tenant_operating_costs$$);
SELECT t.denied('aal1 admin cannot read revenue aggregates', $$SELECT 1 FROM public.tenant_revenue_by_month('aaaaaaaa-0000-0000-0000-000000000001',12)$$);
SELECT t.denied('aal1 admin cannot insert voucher',  $$INSERT INTO public.vouchers (tenant_id, code) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','NOMFA')$$);
SELECT t.denied('aal1 admin cannot edit settings',   $$UPDATE public.tenants SET mpesa_paybill='1' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$);
-- ...but sign-in routing still works before the code is entered
SELECT t.allowed('aal1 admin can still read own role row', $$SELECT 1 FROM public.user_roles WHERE user_id='bbbbbbbb-0000-0000-0000-0000000000a1'$$);
SELECT t.allowed('aal1 admin can still read own profile',  $$SELECT 1 FROM public.profiles WHERE id='bbbbbbbb-0000-0000-0000-0000000000a1'$$);

-- MFA is required even for users who have not enrolled a factor yet.
SELECT t.as_user(:admin2, 'aal1');
SELECT t.denied('aal1 admin without enrolled MFA cannot read tenant data',
                $$SELECT 1 FROM public.customers WHERE tenant_id='aaaaaaaa-0000-0000-0000-000000000002'$$);

-- ---- super_admin ---------------------------------------------------------------------------------
SELECT t.as_user(:super, 'aal1');
SELECT t.denied ('aal1 super admin cannot grant roles', $$INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES ('bbbbbbbb-0000-0000-0000-0000000000d1','tenant_admin','aaaaaaaa-0000-0000-0000-000000000001')$$);
SELECT t.denied ('aal1 super admin cannot read tenants', $$SELECT 1 FROM public.tenants$$);
SELECT t.as_user(:super, 'aal2');
SELECT t.allowed('aal2 super admin reads all tenants',   $$SELECT 1 FROM public.tenants$$);
SELECT t.allowed('aal2 super admin reads all payments',  $$SELECT 1 FROM public.payments$$);
SELECT t.allowed('aal2 super admin reviews all Mood Boost topics', $$SELECT 1 FROM public.mood_boost_topics$$);
SELECT t.allowed('aal2 super admin reads pending Mood Boost content', $$SELECT 1 FROM public.mood_boost_content WHERE moderation_status='pending'$$);
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
INSERT INTO t.results VALUES ('role helper returns own tenant-admin role', public.has_role(auth.uid(), 'tenant_admin'));
INSERT INTO t.results VALUES ('tenant-role helper returns own workspace role', public.has_tenant_role(auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000002', ARRAY['tenant_admin']::public.app_role[]));
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
