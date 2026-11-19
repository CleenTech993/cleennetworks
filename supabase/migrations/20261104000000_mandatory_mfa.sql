-- Require an aal2 session for authenticated access to business tables. Previously, users without
-- an enrolled MFA factor were allowed to use aal1 sessions, so they could bypass the console gate.
CREATE OR REPLACE FUNCTION public.is_aal2()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT COALESCE(auth.jwt() ->> 'role' = 'service_role', false)
      OR COALESCE(auth.jwt() ->> 'aal' = 'aal2', false)
$$;

REVOKE ALL ON FUNCTION public.is_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_aal2() TO authenticated, service_role;
