-- Shared test harness: run `stmt` as a given DB role / user and record whether it was allowed.
-- Included with \ir from the test files; each test file owns its BEGIN ... ROLLBACK.
CREATE SCHEMA t;
CREATE TABLE t.results (label text, want text, got text, pass boolean);

-- Record a plain boolean check (for assertions that are not a single statement).
CREATE FUNCTION t.check(label text, cond boolean) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO t.results VALUES (label, 'true', coalesce(cond, false)::text, coalesce(cond, false));
$f$;

-- Run `stmt` as `rolname`, with auth.uid() = uid. Returns 'ok:<rows>' or 'err:<sqlstate>'.
CREATE FUNCTION t.try(rolname text, uid uuid, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  -- Real Supabase puts the user in one JSON setting (auth.uid() reads it); the per-claim setting
  -- is kept for older stubs. aal2 = signed in AND two-step verified, which the MFA rules require.
  PERFORM set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', 'aal2', 'role', rolname)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', rolname);
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  RETURN 'ok:' || n;
EXCEPTION WHEN OTHERS THEN
  RETURN 'err:' || SQLSTATE;
END $$;

-- want = 'ok'      -> statement must succeed and touch/return >= 1 row
-- want = 'blocked' -> statement must raise an error OR touch/return 0 rows
CREATE FUNCTION t.expect(label text, want text, rolname text, uid uuid, stmt text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text := t.try(rolname, uid, stmt); good boolean;
BEGIN
  good := CASE want WHEN 'ok' THEN got ~ '^ok:[1-9]' ELSE (got ~ '^err:' OR got = 'ok:0') END;
  INSERT INTO t.results VALUES (label, want, got, good);
END $$;

