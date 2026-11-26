-- Router & Access Point chaining constraints, MAC uniqueness, cycle prevention, and liveness alerts.
BEGIN;
\ir _harness.sql
\ir _fixtures.sql

INSERT INTO public.routers (id, tenant_id, name, node_role, mac_address, status, last_heartbeat_at) VALUES
  ('99999999-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Root-A', 'router', 'aa:bb:cc:dd:ee:01', 'online', now()),
  ('99999999-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'Relay-A', 'router', 'aa:bb:cc:dd:ee:02', 'online', now()),
  ('99999999-0000-0000-0000-0000000000c3', 'bbbbbbbb-0000-0000-0000-000000000002', 'Root-B', 'router', 'aa:bb:cc:dd:ee:01', 'online', now());

DO $test$
DECLARE
  admin   uuid := (SELECT id FROM u WHERE label='admin');
  tech    uuid := (SELECT id FROM u WHERE label='tech');
  support uuid := (SELECT id FROM u WHERE label='support');
  adminB  uuid := (SELECT id FROM u WHERE label='adminB');
  v_mac   text;
  v_cnt   integer;
BEGIN
  -- MAC normalized to uppercase
  SELECT mac_address INTO v_mac FROM public.routers WHERE id = '99999999-0000-0000-0000-0000000000c1';
  PERFORM t.check('MAC normalized to uppercase', v_mac = 'AA:BB:CC:DD:EE:01');

  -- Duplicate MAC inside same tenant rejected, different tenant allowed (already inserted Root-B above)
  PERFORM t.expect('duplicate MAC in same tenant rejected', 'blocked', 'service_role', NULL,
    $$INSERT INTO public.routers (tenant_id, name, mac_address) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Dup', 'AA:BB:CC:DD:EE:01')$$);

  -- Invalid MAC rejected
  PERFORM t.expect('invalid MAC rejected', 'blocked', 'authenticated', admin,
    $$INSERT INTO public.routers (tenant_id, name, mac_address) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'BadMac', 'not-a-mac')$$);

  -- Chaining inside same tenant works for admin/technician
  PERFORM t.expect('technician can chain Relay-A under Root-A', 'ok', 'authenticated', tech,
    $$UPDATE public.routers SET parent_router_id = '99999999-0000-0000-0000-0000000000c1', uplink_interface = 'ether2' WHERE id = '99999999-0000-0000-0000-0000000000c2'$$);

  -- Cross-tenant chaining blocked
  PERFORM t.expect('cannot chain router to another tenant parent', 'blocked', 'authenticated', admin,
    $$UPDATE public.routers SET parent_router_id = '99999999-0000-0000-0000-0000000000c3' WHERE id = '99999999-0000-0000-0000-0000000000c2'$$);

  -- Self-parent and cycle blocked
  PERFORM t.expect('cannot chain router to itself', 'blocked', 'authenticated', admin,
    $$UPDATE public.routers SET parent_router_id = '99999999-0000-0000-0000-0000000000c1' WHERE id = '99999999-0000-0000-0000-0000000000c1'$$);
  PERFORM t.expect('cannot create a chain loop', 'blocked', 'authenticated', admin,
    $$UPDATE public.routers SET parent_router_id = '99999999-0000-0000-0000-0000000000c2' WHERE id = '99999999-0000-0000-0000-0000000000c1'$$);

  -- Liveness sweeper raises router_down alert with chain info
  UPDATE public.routers SET last_heartbeat_at = now() - interval '10 minutes'
   WHERE id = '99999999-0000-0000-0000-0000000000c2';
  SELECT public.check_router_liveness() INTO v_cnt;
  PERFORM t.check('liveness sweeper flagged stale chained router', v_cnt >= 1);
  PERFORM t.check('liveness sweeper inserted router_down alert',
    EXISTS (SELECT 1 FROM public.inventory_alerts WHERE router_id = '99999999-0000-0000-0000-0000000000c2' AND kind = 'router_down' AND message LIKE '%Root-A%'));

  -- Support staff in same tenant can read alert, other tenant cannot
  PERFORM t.expect('support staff can read router_down alert', 'ok', 'authenticated', support,
    $$SELECT 1 FROM public.inventory_alerts WHERE router_id = '99999999-0000-0000-0000-0000000000c2'$$);
  PERFORM t.check('other tenant sees zero alerts for tenant A router',
    (SELECT count(*) FROM public.inventory_alerts WHERE router_id = '99999999-0000-0000-0000-0000000000c2' AND tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0);
  PERFORM t.expect('other tenant admin cannot read tenant A alerts', 'empty', 'authenticated', adminB,
    $$SELECT 1 FROM public.inventory_alerts WHERE router_id = '99999999-0000-0000-0000-0000000000c2'$$);
END $test$;

SELECT pass, label, want, got FROM t.results ORDER BY pass, label;

DO $$
DECLARE bad int := (SELECT count(*) FROM t.results WHERE NOT pass);
BEGIN
  IF bad > 0 THEN RAISE EXCEPTION '% of % router-chaining expectations failed', bad, (SELECT count(*) FROM t.results); END IF;
  RAISE NOTICE 'all % router-chaining expectations passed', (SELECT count(*) FROM t.results);
END $$;
ROLLBACK;
