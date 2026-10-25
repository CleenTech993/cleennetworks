-- Inventory access + integrity test. Run on a THROWAWAY database with all migrations applied:
--   psql -v ON_ERROR_STOP=1 -d <scratch_db> -f tests/sql/inventory.sql
-- One transaction, rolled back at the end. Any wrong result aborts with a message.
BEGIN;

CREATE FUNCTION public.t_n(label text, actual bigint, expected bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL: % (got %, expected %)', label, actual, expected; END IF; END$$;
CREATE FUNCTION public.t_s(label text, actual text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL: % (got %, expected %)', label, actual, expected; END IF; END$$;
-- 'ok' or the SQLSTATE the statement failed with (42501 = denied, 23514 = check violation)
CREATE FUNCTION public.t_state(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END$$;
CREATE FUNCTION public.t_rows(q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END$$;
CREATE FUNCTION public.t_as(uid text, aal text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', uid, true), set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', aal)::text, true) $$;

-- ---- fixtures (superuser) ----
INSERT INTO public.tenants (id, name, slug) VALUES
  ('a0000000-0000-0000-0000-000000000001','T1','t1-inv'),('a0000000-0000-0000-0000-000000000002','T2','t2-inv');
INSERT INTO auth.users (id, email) VALUES
  ('b0000000-0000-0000-0000-000000000001','admin1@t.test'),('b0000000-0000-0000-0000-000000000002','tech1@t.test'),
  ('b0000000-0000-0000-0000-000000000003','bill1@t.test'),('b0000000-0000-0000-0000-000000000004','supp1@t.test'),
  ('b0000000-0000-0000-0000-000000000005','admin2@t.test');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('b0000000-0000-0000-0000-000000000001','tenant_admin','a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002','technician','a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000003','billing_agent','a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000004','support_staff','a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000005','tenant_admin','a0000000-0000-0000-0000-000000000002');
INSERT INTO public.customers (id, tenant_id) VALUES
  ('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002');
INSERT INTO public.routers (id, tenant_id, name) VALUES
  ('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','r1'),
  ('c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','r2');
-- T2 has an item and a device that T1 users must never be able to touch or reference
INSERT INTO public.inventory_items (id, tenant_id, category, name) VALUES ('e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','cable','T2 cable');
INSERT INTO public.inventory_devices (id, tenant_id, category, name) VALUES ('f0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','switch','T2 switch');

-- ===== tenant admin (T1, aal2) =====
SET LOCAL ROLE authenticated;
SELECT public.t_as('b0000000-0000-0000-0000-000000000001','aal2');
SELECT public.t_s('create cable item', public.t_state($q$INSERT INTO inventory_items (id,tenant_id,category,name,unit,reorder_level) VALUES ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','cable','Cat6 box','m',100)$q$),'ok');
SELECT public.t_s('item with opening quantity is refused', public.t_state($q$INSERT INTO inventory_items (tenant_id,category,name,quantity) VALUES ('a0000000-0000-0000-0000-000000000001','ont','x',5)$q$),'42501');
SELECT public.t_s('receive 500m', public.t_state($q$INSERT INTO stock_movements (tenant_id,item_id,change,reason) VALUES ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',500,'received')$q$),'ok');
SELECT public.t_n('stock is 500', (SELECT quantity FROM inventory_items WHERE id='e0000000-0000-0000-0000-000000000001')::bigint, 500);
SELECT public.t_s('issue 120m to customer', public.t_state($q$INSERT INTO stock_movements (tenant_id,item_id,change,reason,customer_id) VALUES ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',-120,'issued','d0000000-0000-0000-0000-000000000001')$q$),'ok');
SELECT public.t_n('stock is 380', (SELECT quantity FROM inventory_items WHERE id='e0000000-0000-0000-0000-000000000001')::bigint, 380);
SELECT public.t_s('cannot issue more than in stock', public.t_state($q$INSERT INTO stock_movements (tenant_id,item_id,change,reason) VALUES ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',-1000,'issued')$q$),'23514');
SELECT public.t_n('failed issue left stock unchanged', (SELECT quantity FROM inventory_items WHERE id='e0000000-0000-0000-0000-000000000001')::bigint, 380);
SELECT public.t_s('received must be positive', public.t_state($q$INSERT INTO stock_movements (tenant_id,item_id,change,reason) VALUES ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',-5,'received')$q$),'23514');
SELECT public.t_s('cannot set stock level directly', public.t_state($q$UPDATE inventory_items SET quantity=9999 WHERE id='e0000000-0000-0000-0000-000000000001'$q$),'42501');
SELECT public.t_s('ledger rows cannot be edited', public.t_state($q$UPDATE stock_movements SET change=1$q$),'42501');
SELECT public.t_s('ledger rows cannot be deleted', public.t_state($q$DELETE FROM stock_movements$q$),'42501');
SELECT public.t_s('cannot move stock of another tenant''s item', public.t_state($q$INSERT INTO stock_movements (tenant_id,item_id,change,reason) VALUES ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',10,'received')$q$),'42501');
SELECT public.t_s('cannot issue to another tenant''s customer', public.t_state($q$INSERT INTO stock_movements (tenant_id,item_id,change,reason,customer_id) VALUES ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',-1,'issued','d0000000-0000-0000-0000-000000000002')$q$),'42501');
SELECT public.t_s('pieces must be whole', public.t_state($q$INSERT INTO inventory_items (id,tenant_id,category,name,unit) VALUES ('e0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','ont','ONT','pcs')$q$),'ok');
SELECT public.t_s('fractional pieces refused', public.t_state($q$INSERT INTO stock_movements (tenant_id,item_id,change,reason) VALUES ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003',1.5,'received')$q$),'23514');
-- devices
SELECT public.t_s('add AP with monitoring', public.t_state($q$INSERT INTO inventory_devices (id,tenant_id,category,name,serial_number,ip_address,monitor_enabled,monitor_router_id,status) VALUES ('f0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','access_point','AP-1','SN1','10.0.0.5',true,'c0000000-0000-0000-0000-000000000001','deployed')$q$),'ok');
SELECT public.t_s('duplicate serial refused', public.t_state($q$INSERT INTO inventory_devices (tenant_id,category,name,serial_number) VALUES ('a0000000-0000-0000-0000-000000000001','ont','dup','sn1')$q$),'23505');
SELECT public.t_s('monitoring needs an IP', public.t_state($q$INSERT INTO inventory_devices (tenant_id,category,name,monitor_enabled,monitor_router_id) VALUES ('a0000000-0000-0000-0000-000000000001','ont','n',true,'c0000000-0000-0000-0000-000000000001')$q$),'23514');
SELECT public.t_s('bad IP refused', public.t_state($q$INSERT INTO inventory_devices (tenant_id,category,name,ip_address) VALUES ('a0000000-0000-0000-0000-000000000001','ont','n','10.0.0.300')$q$),'23514');
SELECT public.t_s('IP with shell characters refused', public.t_state($q$INSERT INTO inventory_devices (tenant_id,category,name,ip_address) VALUES ('a0000000-0000-0000-0000-000000000001','ont','n','1.1.1.1"; /system reset-configuration')$q$),'23514');
SELECT public.t_s('bad MAC refused', public.t_state($q$INSERT INTO inventory_devices (tenant_id,category,name,mac_address) VALUES ('a0000000-0000-0000-0000-000000000001','ont','n','nope')$q$),'23514');
SELECT public.t_s('assign to customer', public.t_state($q$INSERT INTO inventory_devices (id,tenant_id,category,name,status,customer_id) VALUES ('f0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','ont','ONT-1','deployed','d0000000-0000-0000-0000-000000000001')$q$),'ok');
SELECT public.t_s('in-stock device cannot have a customer', public.t_state($q$UPDATE inventory_devices SET status='in_stock' WHERE id='f0000000-0000-0000-0000-000000000003'$q$),'23514');
SELECT public.t_s('cannot assign to another tenant''s customer', public.t_state($q$UPDATE inventory_devices SET customer_id='d0000000-0000-0000-0000-000000000002' WHERE id='f0000000-0000-0000-0000-000000000003'$q$),'42501');
SELECT public.t_s('cannot monitor from another tenant''s router', public.t_state($q$UPDATE inventory_devices SET monitor_router_id='c0000000-0000-0000-0000-000000000002' WHERE id='f0000000-0000-0000-0000-000000000001'$q$),'42501');
SELECT public.t_s('cannot link another tenant''s item', public.t_state($q$UPDATE inventory_devices SET item_id='e0000000-0000-0000-0000-000000000002' WHERE id='f0000000-0000-0000-0000-000000000001'$q$),'42501');
SELECT public.t_s('cannot fake the online reading on insert', public.t_state($q$INSERT INTO inventory_devices (tenant_id,category,name,online) VALUES ('a0000000-0000-0000-0000-000000000001','ont','n',true)$q$),'42501');
SELECT public.t_s('cannot fake the online reading on update', public.t_state($q$UPDATE inventory_devices SET online=true WHERE id='f0000000-0000-0000-0000-000000000001'$q$),'42501');
SELECT public.t_s('cannot change tenant of a device', public.t_state($q$UPDATE inventory_devices SET tenant_id='a0000000-0000-0000-0000-000000000002' WHERE id='f0000000-0000-0000-0000-000000000001'$q$),'42501');
SELECT public.t_n('admin sees T1 devices only', (SELECT count(*) FROM inventory_devices), 2);
SELECT public.t_n('admin sees T1 items only', (SELECT count(*) FROM inventory_items), 2);
SELECT public.t_n('admin cannot update other tenant device', public.t_rows($q$UPDATE inventory_devices SET name='x' WHERE id='f0000000-0000-0000-0000-000000000002'$q$), 0);
SELECT public.t_n('admin cannot delete other tenant item', public.t_rows($q$DELETE FROM inventory_items WHERE id='e0000000-0000-0000-0000-000000000002'$q$), 0);
RESET ROLE;

-- ===== same admin WITHOUT two-step verification (aal1) sees nothing and can write nothing =====
SET LOCAL ROLE authenticated;
SELECT public.t_as('b0000000-0000-0000-0000-000000000001','aal1');
SELECT public.t_n('aal1 sees no devices', (SELECT count(*) FROM inventory_devices), 0);
SELECT public.t_n('aal1 sees no items', (SELECT count(*) FROM inventory_items), 0);
SELECT public.t_s('aal1 cannot add stock', public.t_state($q$INSERT INTO stock_movements (tenant_id,item_id,change,reason) VALUES ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',10,'received')$q$),'42501');
RESET ROLE;

-- ===== technician: read + write =====
SET LOCAL ROLE authenticated;
SELECT public.t_as('b0000000-0000-0000-0000-000000000002','aal2');
SELECT public.t_n('tech sees devices', (SELECT count(*) FROM inventory_devices), 2);
SELECT public.t_s('tech adds a switch', public.t_state($q$INSERT INTO inventory_devices (tenant_id,category,name) VALUES ('a0000000-0000-0000-0000-000000000001','switch','SW-1')$q$),'ok');
SELECT public.t_s('tech receives stock', public.t_state($q$INSERT INTO stock_movements (tenant_id,item_id,change,reason) VALUES ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',50,'received')$q$),'ok');
RESET ROLE;

-- ===== billing agent: no inventory at all =====
SET LOCAL ROLE authenticated;
SELECT public.t_as('b0000000-0000-0000-0000-000000000003','aal2');
SELECT public.t_n('billing sees no items', (SELECT count(*) FROM inventory_items), 0);
SELECT public.t_n('billing sees no devices', (SELECT count(*) FROM inventory_devices), 0);
SELECT public.t_n('billing sees no ledger', (SELECT count(*) FROM stock_movements), 0);
SELECT public.t_s('billing cannot add a device', public.t_state($q$INSERT INTO inventory_devices (tenant_id,category,name) VALUES ('a0000000-0000-0000-0000-000000000001','ont','n')$q$),'42501');
RESET ROLE;

-- ===== support staff: read only =====
SET LOCAL ROLE authenticated;
SELECT public.t_as('b0000000-0000-0000-0000-000000000004','aal2');
SELECT public.t_n('support sees devices', (SELECT count(*) FROM inventory_devices), 3);
SELECT public.t_n('support sees items', (SELECT count(*) FROM inventory_items), 2);
SELECT public.t_n('support sees ledger', (SELECT count(*) FROM stock_movements), 3);
SELECT public.t_s('support cannot add a device', public.t_state($q$INSERT INTO inventory_devices (tenant_id,category,name) VALUES ('a0000000-0000-0000-0000-000000000001','ont','n')$q$),'42501');
SELECT public.t_n('support cannot edit a device', public.t_rows($q$UPDATE inventory_devices SET name='x'$q$), 0);
SELECT public.t_s('support cannot move stock', public.t_state($q$INSERT INTO stock_movements (tenant_id,item_id,change,reason) VALUES ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',1,'received')$q$),'42501');
RESET ROLE;

-- ===== other tenant's admin cannot see T1's inventory =====
SET LOCAL ROLE authenticated;
SELECT public.t_as('b0000000-0000-0000-0000-000000000005','aal2');
SELECT public.t_n('admin2 sees only its own device', (SELECT count(*) FROM inventory_devices), 1);
SELECT public.t_n('admin2 sees no T1 items', (SELECT count(*) FROM inventory_items WHERE tenant_id='a0000000-0000-0000-0000-000000000001'), 0);
RESET ROLE;

-- ===== platform (service role) writes monitoring readings + history =====
SET LOCAL ROLE service_role;
SELECT public.t_n('service role records a reading', public.t_rows($q$UPDATE inventory_devices SET online=true, loss_pct=0, last_checked_at=now(), last_seen_at=now(), status_changed_at=now() WHERE id='f0000000-0000-0000-0000-000000000001'$q$), 1);
SELECT public.t_s('service role records an event', public.t_state($q$INSERT INTO inventory_device_events (tenant_id,device_id,event) VALUES ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','down')$q$),'ok');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT public.t_as('b0000000-0000-0000-0000-000000000002','aal2');
SELECT public.t_n('tech sees the reading', (SELECT count(*) FROM inventory_devices WHERE online), 1);
SELECT public.t_n('tech sees the history', (SELECT count(*) FROM inventory_device_events), 1);
SELECT public.t_s('tech cannot write history', public.t_state($q$INSERT INTO inventory_device_events (tenant_id,device_id,event) VALUES ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','up')$q$),'42501');
-- changing what is monitored clears the stale reading
SELECT public.t_s('retarget monitoring', public.t_state($q$UPDATE inventory_devices SET ip_address='10.0.0.6' WHERE id='f0000000-0000-0000-0000-000000000001'$q$),'ok');
SELECT public.t_n('stale reading cleared', (SELECT count(*) FROM inventory_devices WHERE online IS NOT NULL), 0);
RESET ROLE;

DROP FUNCTION public.t_n(text,bigint,bigint); DROP FUNCTION public.t_s(text,text,text); DROP FUNCTION public.t_state(text);
DROP FUNCTION public.t_rows(text); DROP FUNCTION public.t_as(text,text);
ROLLBACK;
\echo ALL INVENTORY CHECKS PASSED
