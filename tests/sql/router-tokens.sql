-- Router token rules: server-generated bootstrap tokens, rotate / revoke, hidden device credentials.
-- Run like role-aware-rls.sql (see the header there) after ALL migrations are applied.
--   psql -d scratch -v ON_ERROR_STOP=1 -f tests/sql/router-tokens.sql
BEGIN;
\ir _harness.sql
\ir _fixtures.sql

-- A router that already exists (legacy: provisioned before device credentials), one with a device credential.
INSERT INTO public.routers (id, tenant_id, name, provision_token, provision_token_expires_at, legacy_token_auth) VALUES
  ('99999999-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Legacy', 'legacytoken', now() - interval '3 days', true),
  ('99999999-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'Modern', 'oldbootstrap', now() - interval '3 days', false);
INSERT INTO public.router_credentials (router_id, token_hash) VALUES
  ('99999999-0000-0000-0000-0000000000a2', 'deadbeef');

DO $test$
DECLARE
  admin   uuid := (SELECT id FROM u WHERE label='admin');
  tech    uuid := (SELECT id FROM u WHERE label='tech');
  billing uuid := (SELECT id FROM u WHERE label='billing');
  support uuid := (SELECT id FROM u WHERE label='support');
  adminB  uuid := (SELECT id FROM u WHERE label='adminB');
  sup     uuid := (SELECT id FROM u WHERE label='super');
  A constant text := 'aaaaaaaa-0000-0000-0000-000000000001';
  r record;
  old_tok text;
BEGIN
  -- client-supplied tokens are ignored on insert: the server generates them
  PERFORM t.expect('insert: admin can add a router', 'ok', 'authenticated', admin,
    format('INSERT INTO public.routers (tenant_id, name, provision_token, provision_token_expires_at) VALUES (%L, %L, %L, %L)',
           A, 'Fresh', 'weak', now() + interval '10 years'));
  SELECT * INTO r FROM public.routers WHERE name = 'Fresh';
  PERFORM t.check('insert: client-chosen token discarded',            r.provision_token <> 'weak' AND length(r.provision_token) >= 60);
  PERFORM t.check('insert: expiry forced to ~24h, not client value',  r.provision_token_expires_at < now() + interval '25 hours'
                                                                      AND r.provision_token_expires_at > now() + interval '23 hours');
  PERFORM t.check('insert: new routers never use legacy auth',        r.legacy_token_auth = false);

  -- tokens cannot be edited directly, other columns still can
  PERFORM t.expect('update: cannot set provision_token',   'blocked', 'authenticated', admin, format('UPDATE public.routers SET provision_token = %L WHERE name = %L', 'mine', 'Fresh'));
  PERFORM t.expect('update: cannot extend expiry',         'blocked', 'authenticated', admin, format('UPDATE public.routers SET provision_token_expires_at = now() + interval %L WHERE name = %L', '1 year', 'Fresh'));
  PERFORM t.expect('update: cannot re-enable legacy auth', 'blocked', 'authenticated', admin, format('UPDATE public.routers SET legacy_token_auth = true WHERE name = %L', 'Fresh'));
  PERFORM t.expect('update: technician can still rename',  'ok',      'authenticated', tech,  format('UPDATE public.routers SET name = %L WHERE name = %L', 'Fresh2', 'Fresh'));

  -- device credentials are invisible to clients
  PERFORM t.expect('credentials: admin cannot read',    'blocked', 'authenticated', admin, 'SELECT 1 FROM public.router_credentials');
  PERFORM t.expect('credentials: super cannot read',    'blocked', 'authenticated', sup,   'SELECT 1 FROM public.router_credentials');
  PERFORM t.expect('credentials: admin cannot write',   'blocked', 'authenticated', admin, 'DELETE FROM public.router_credentials');
  PERFORM t.expect('credentials: anon cannot read',     'blocked', 'anon',          NULL,  'SELECT 1 FROM public.router_credentials');
  PERFORM t.expect('credentials: service role can read','ok',      'service_role',  NULL,  'SELECT 1 FROM public.router_credentials');

  -- rotate: who may call it
  PERFORM t.expect('rotate: support staff blocked',     'blocked', 'authenticated', support, 'SELECT public.rotate_router_token($$99999999-0000-0000-0000-0000000000a1$$)');
  PERFORM t.expect('rotate: billing agent blocked',     'blocked', 'authenticated', billing, 'SELECT public.rotate_router_token($$99999999-0000-0000-0000-0000000000a1$$)');
  PERFORM t.expect('rotate: other tenant blocked',      'blocked', 'authenticated', adminB,  'SELECT public.rotate_router_token($$99999999-0000-0000-0000-0000000000a1$$)');
  PERFORM t.expect('rotate: anon blocked',              'blocked', 'anon',          NULL,    'SELECT public.rotate_router_token($$99999999-0000-0000-0000-0000000000a1$$)');
  PERFORM t.expect('rotate: unknown router blocked',    'blocked', 'authenticated', admin,   'SELECT public.rotate_router_token($$99999999-0000-0000-0000-00000000ffff$$)');
  PERFORM t.check ('rotate: blocked calls changed nothing', (SELECT provision_token FROM public.routers WHERE name='Legacy') = 'legacytoken');

  -- rotate (no revoke): new 24h token, router keeps its current credential
  PERFORM t.expect('rotate: technician can rotate',     'ok', 'authenticated', tech, 'SELECT public.rotate_router_token($$99999999-0000-0000-0000-0000000000a2$$)');
  SELECT * INTO r FROM public.routers WHERE name = 'Modern';
  PERFORM t.check('rotate: token replaced, long and random',     r.provision_token <> 'oldbootstrap' AND length(r.provision_token) >= 60);
  PERFORM t.check('rotate: expiry reset to ~24h',                r.provision_token_expires_at > now() + interval '23 hours' AND r.provision_token_expires_at < now() + interval '25 hours');
  PERFORM t.check('rotate: device credential kept without revoke', EXISTS (SELECT 1 FROM public.router_credentials WHERE router_id = r.id));

  -- rotate + revoke on a legacy router: legacy auth off, so the OLD scheduler URLs stop working
  PERFORM t.expect('revoke: admin can revoke legacy router', 'ok', 'authenticated', admin, 'SELECT public.rotate_router_token($$99999999-0000-0000-0000-0000000000a1$$, true)');
  SELECT * INTO r FROM public.routers WHERE name = 'Legacy';
  PERFORM t.check('revoke: legacy router token replaced',  r.provision_token <> 'legacytoken');
  PERFORM t.check('revoke: legacy auth switched off',      r.legacy_token_auth = false);

  -- rotate + revoke on a router with a device credential
  PERFORM t.expect('revoke: super admin can revoke', 'ok', 'authenticated', sup, 'SELECT public.rotate_router_token($$99999999-0000-0000-0000-0000000000a2$$, true)');
  PERFORM t.check('revoke: device credential deleted', NOT EXISTS (SELECT 1 FROM public.router_credentials WHERE router_id = '99999999-0000-0000-0000-0000000000a2'));

  -- deleting a router removes its credential
  INSERT INTO public.router_credentials (router_id, token_hash) VALUES ('99999999-0000-0000-0000-0000000000a1', 'cafebabe');
  DELETE FROM public.routers WHERE id = '99999999-0000-0000-0000-0000000000a1';
  PERFORM t.check('delete: credential cascades with router', NOT EXISTS (SELECT 1 FROM public.router_credentials WHERE token_hash = 'cafebabe'));
END $test$;

SELECT pass, label, want, got FROM t.results ORDER BY pass, label;

DO $$
DECLARE bad int := (SELECT count(*) FROM t.results WHERE NOT pass);
BEGIN
  IF bad > 0 THEN RAISE EXCEPTION '% of % router-token expectations failed', bad, (SELECT count(*) FROM t.results); END IF;
  RAISE NOTICE 'all % router-token expectations passed', (SELECT count(*) FROM t.results);
END $$;
ROLLBACK;
