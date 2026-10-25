-- Checks for 20261028000000_platform_gateway_secrets.sql: encrypted gateway credentials must be
-- reachable by the server's service role ONLY, never by any browser session (anon or signed-in).
DO $$
DECLARE
  n int;
  denied boolean;
BEGIN
  -- The server (service role) can store, read and remove values.
  SET LOCAL ROLE service_role;
  INSERT INTO public.platform_gateway_secrets (name, ciphertext, last4) VALUES ('INTASEND_SECRET_KEY', 'v1.aaaa.bbbb', 'cdef');
  SELECT count(*) INTO n FROM public.platform_gateway_secrets;
  IF n <> 1 THEN RAISE EXCEPTION 'service_role should see its row'; END IF;
  RESET ROLE;

  -- Only the two known names are allowed.
  BEGIN
    INSERT INTO public.platform_gateway_secrets (name, ciphertext) VALUES ('ANYTHING_ELSE', 'v1.a.b');
    RAISE EXCEPTION 'unknown secret name was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Signed-in browser sessions (this is the role a super admin's own session uses) and anon: no read ...
  FOR n IN 1..2 LOOP
    denied := false;
    BEGIN
      IF n = 1 THEN SET LOCAL ROLE authenticated; ELSE SET LOCAL ROLE anon; END IF;
      PERFORM 1 FROM public.platform_gateway_secrets;
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    RESET ROLE;
    IF NOT denied THEN RAISE EXCEPTION 'role % could read the secrets table', CASE n WHEN 1 THEN 'authenticated' ELSE 'anon' END; END IF;

    -- ... no write ...
    denied := false;
    BEGIN
      IF n = 1 THEN SET LOCAL ROLE authenticated; ELSE SET LOCAL ROLE anon; END IF;
      INSERT INTO public.platform_gateway_secrets (name, ciphertext) VALUES ('INTASEND_WEBHOOK_CHALLENGE', 'v1.x.y');
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    RESET ROLE;
    IF NOT denied THEN RAISE EXCEPTION 'role % could write the secrets table', CASE n WHEN 1 THEN 'authenticated' ELSE 'anon' END; END IF;

    -- ... and no tampering with the existing row.
    denied := false;
    BEGIN
      IF n = 1 THEN SET LOCAL ROLE authenticated; ELSE SET LOCAL ROLE anon; END IF;
      UPDATE public.platform_gateway_secrets SET ciphertext = 'v1.evil.value';
      DELETE FROM public.platform_gateway_secrets;
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    RESET ROLE;
    IF NOT denied THEN RAISE EXCEPTION 'role % could modify the secrets table', CASE n WHEN 1 THEN 'authenticated' ELSE 'anon' END; END IF;
  END LOOP;

  -- The row survived all of that, untouched.
  SELECT count(*) INTO n FROM public.platform_gateway_secrets WHERE ciphertext = 'v1.aaaa.bbbb';
  IF n <> 1 THEN RAISE EXCEPTION 'the stored row was altered'; END IF;

  -- RLS is on as a second layer (so a future accidental GRANT still exposes nothing without a policy).
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_gateway_secrets'::regclass) THEN
    RAISE EXCEPTION 'row level security is not enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'platform_gateway_secrets') THEN
    RAISE EXCEPTION 'unexpected policy on the secrets table';
  END IF;

  DELETE FROM public.platform_gateway_secrets;
  RAISE NOTICE 'gateway secrets checks passed';
END $$;
