-- PPPoE rules: one credential = one router, router-reported MAC/IP, and the report function.
-- Run through tests/sql/run.sh (fresh database with every migration applied).
BEGIN;
\ir _harness.sql
\ir _fixtures.sql

INSERT INTO public.routers (id, tenant_id, name) VALUES
  ('99999999-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Tower 1'),
  ('99999999-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'Tower 2'),
  ('99999999-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000002', 'Rival tower');

INSERT INTO public.customers (id, tenant_id, customer_type, pppoe_username, pppoe_password, router_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'pppoe', 'alice', 'pw-alice', '99999999-0000-0000-0000-0000000000a1'),
  ('c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'pppoe', 'bob',   'pw-bob',   '99999999-0000-0000-0000-0000000000a2'),
  ('c0000000-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000002', 'pppoe', 'alice', 'pw-rival', '99999999-0000-0000-0000-0000000000b1');
-- A client from before this rule existed: no router. (The guard is switched off only to create it.)
ALTER TABLE public.customers DISABLE TRIGGER guard_pppoe_customer;
INSERT INTO public.customers (id, tenant_id, customer_type, pppoe_username, pppoe_password, router_id) VALUES
  ('c0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'pppoe', 'carol', 'pw-carol', NULL);
ALTER TABLE public.customers ENABLE TRIGGER guard_pppoe_customer;

DO $test$
DECLARE
  A  constant text := 'aaaaaaaa-0000-0000-0000-000000000001';
  B  constant text := 'bbbbbbbb-0000-0000-0000-000000000002';
  R1 constant text := '99999999-0000-0000-0000-0000000000a1';
  R2 constant text := '99999999-0000-0000-0000-0000000000a2';
  RB constant text := '99999999-0000-0000-0000-0000000000b1';
  admin   uuid := (SELECT id FROM u WHERE label='admin');
  billing uuid := (SELECT id FROM u WHERE label='billing');
  adminB  uuid := (SELECT id FROM u WHERE label='adminB');
  n int;
  r record;
BEGIN
  -- one credential, one router
  PERFORM t.expect('create: client with a router is fine', 'ok', 'authenticated', admin,
    format('INSERT INTO public.customers (tenant_id, customer_type, pppoe_username, pppoe_password, router_id) VALUES (%L, %L, %L, %L, %L)', A, 'pppoe', 'dave', 'pw-dave', R1));
  PERFORM t.expect('create: PPPoE client without a router is refused', 'blocked', 'authenticated', admin,
    format('INSERT INTO public.customers (tenant_id, customer_type, pppoe_username, pppoe_password) VALUES (%L, %L, %L, %L)', A, 'pppoe', 'erin', 'pw-erin'));
  PERFORM t.expect('create: another tenant''s router is refused', 'blocked', 'authenticated', admin,
    format('INSERT INTO public.customers (tenant_id, customer_type, pppoe_username, pppoe_password, router_id) VALUES (%L, %L, %L, %L, %L)', A, 'pppoe', 'frank', 'pw-frank', RB));
  PERFORM t.expect('create: hotspot customers do not need a router', 'ok', 'authenticated', admin,
    format('INSERT INTO public.customers (tenant_id, customer_type, full_name) VALUES (%L, %L, %L)', A, 'hotspot', 'Walk-in'));
  PERFORM t.expect('move: client can be moved to another router of the tenant', 'ok', 'authenticated', billing,
    format('UPDATE public.customers SET router_id = %L WHERE pppoe_username = %L AND tenant_id = %L', R2, 'dave', A));
  PERFORM t.expect('move: cannot be moved to another tenant''s router', 'blocked', 'authenticated', admin,
    format('UPDATE public.customers SET router_id = %L WHERE pppoe_username = %L AND tenant_id = %L', RB, 'dave', A));
  PERFORM t.expect('move: cannot be un-assigned', 'blocked', 'authenticated', admin,
    format('UPDATE public.customers SET router_id = NULL WHERE pppoe_username = %L AND tenant_id = %L', 'dave', A));

  -- clients that predate the rule keep working and can be assigned
  PERFORM t.expect('legacy: unassigned client can still be suspended', 'ok', 'authenticated', admin,
    format('UPDATE public.customers SET status = %L WHERE pppoe_username = %L AND tenant_id = %L', 'suspended', 'carol', A));
  PERFORM t.expect('legacy: unassigned client can be assigned a router', 'ok', 'authenticated', admin,
    format('UPDATE public.customers SET router_id = %L WHERE pppoe_username = %L AND tenant_id = %L', R1, 'carol', A));

  -- deleting a router must not be blocked by the rule: its clients just become unassigned
  PERFORM t.expect('delete: a router with clients can still be deleted', 'ok', 'authenticated', admin,
    format('DELETE FROM public.routers WHERE id = %L', R2));
  PERFORM t.check('delete: its clients are left unassigned (not lost)',
    (SELECT router_id IS NULL FROM public.customers WHERE pppoe_username = 'bob' AND tenant_id = A::uuid));

  -- router-reported fields cannot be edited from the browser
  PERFORM t.expect('forge: cannot edit last_mac', 'blocked', 'authenticated', admin,
    format('UPDATE public.customers SET last_mac = %L WHERE pppoe_username = %L AND tenant_id = %L', 'AA:BB:CC:DD:EE:FF', 'alice', A));
  PERFORM t.expect('forge: cannot fake being seen', 'blocked', 'authenticated', admin,
    format('UPDATE public.customers SET last_seen_at = now() WHERE pppoe_username = %L AND tenant_id = %L', 'alice', A));
  PERFORM t.expect('forge: other fields remain editable', 'ok', 'authenticated', admin,
    format('UPDATE public.customers SET full_name = %L WHERE pppoe_username = %L AND tenant_id = %L', 'Alice A.', 'alice', A));
  PERFORM t.expect('forge: insert with last_mac is accepted but the value is discarded', 'ok', 'authenticated', admin,
    format('INSERT INTO public.customers (tenant_id, customer_type, pppoe_username, pppoe_password, router_id, last_mac) VALUES (%L, %L, %L, %L, %L, %L)', A, 'pppoe', 'gina', 'pw-gina', R1, '11:22:33:44:55:66'));
  PERFORM t.check('forge: discarded on insert', (SELECT last_mac IS NULL FROM public.customers WHERE pppoe_username = 'gina'));

  -- the report function
  PERFORM t.expect('report: not callable by a signed-in user', 'blocked', 'authenticated', admin,
    format('SELECT public.record_pppoe_sessions(%L, %L, %L)', R1, A, '[]'));
  PERFORM t.expect('report: not callable anonymously', 'blocked', 'anon', NULL,
    format('SELECT public.record_pppoe_sessions(%L, %L, %L)', R1, A, '[]'));
  PERFORM t.expect('report: callable by the service role', 'ok', 'service_role', NULL,
    format('SELECT public.record_pppoe_sessions(%L, %L, %L)', R1, A, '[]'));

  -- (called as the table owner here, exactly what the service role's definer function runs as)
  n := public.record_pppoe_sessions(R1::uuid, A::uuid, jsonb_build_array(
        jsonb_build_object('username','alice','mac','AA:BB:CC:00:00:01','ip','10.10.0.2'),   -- assigned to R1
        jsonb_build_object('username','bob',  'mac','AA:BB:CC:00:00:02','ip','10.10.0.3'),   -- now unassigned (router deleted)
        jsonb_build_object('username','carol','mac','AA:BB:CC:00:00:03','ip','10.10.0.4'),   -- legacy, unassigned
        jsonb_build_object('username','nobody','mac','AA:BB:CC:00:00:04','ip','10.10.0.5'))); -- unknown login
  PERFORM t.check('report: updates the clients it recognises (3 of 4)', n = 3);
  SELECT * INTO r FROM public.customers WHERE pppoe_username = 'alice' AND tenant_id = A::uuid;
  PERFORM t.check('report: stores MAC, IP, router and time', r.last_mac = 'AA:BB:CC:00:00:01' AND r.last_ip = '10.10.0.2'
                  AND r.last_router_id = R1::uuid AND r.last_seen_at > now() - interval '1 minute');
  PERFORM t.check('report: other tenant''s client with the same username is untouched',
    (SELECT last_mac IS NULL FROM public.customers WHERE pppoe_username = 'alice' AND tenant_id = B::uuid));

  -- a credential assigned to router 2 appearing on router 1 is ignored (one credential, one router)
  UPDATE public.customers SET router_id = R1::uuid, last_mac = NULL, last_seen_at = NULL WHERE pppoe_username = 'bob';
  INSERT INTO public.routers (id, tenant_id, name) VALUES ('99999999-0000-0000-0000-0000000000a3', A::uuid, 'Tower 3');
  UPDATE public.customers SET router_id = '99999999-0000-0000-0000-0000000000a3' WHERE pppoe_username = 'bob';
  n := public.record_pppoe_sessions(R1::uuid, A::uuid, jsonb_build_array(
        jsonb_build_object('username','bob','mac','AA:BB:CC:00:00:09','ip','10.10.0.9')));
  PERFORM t.check('report: a credential seen on the WRONG router is ignored', n = 0
    AND (SELECT last_mac IS NULL FROM public.customers WHERE pppoe_username = 'bob'));
END $test$;

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, label, want, got FROM t.results ORDER BY pass, label;

DO $$
DECLARE bad int := (SELECT count(*) FROM t.results WHERE NOT pass);
BEGIN
  IF bad > 0 THEN RAISE EXCEPTION '% of % PPPoE expectations failed', bad, (SELECT count(*) FROM t.results); END IF;
  RAISE NOTICE 'all % PPPoE expectations passed', (SELECT count(*) FROM t.results);
END $$;
ROLLBACK;
