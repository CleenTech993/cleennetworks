-- Allow admins to optionally activate or disable Two-Factor Authentication (MFA).
-- Previously, is_aal2() strictly required auth.jwt() ->> 'aal' = 'aal2'.
-- When an admin chose to disable MFA, their session was at 'aal1', causing
-- the restrictive RLS policies on all business tables to hide all rows.
--
-- This update checks whether the caller has an active, verified MFA factor in auth.mfa_factors.
-- If the admin has MFA enabled: aal2 is strictly required.
-- If the admin has MFA disabled (no verified factor): the aal1 password session is permitted.

CREATE OR REPLACE FUNCTION public.is_aal2()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text;
  v_aal text;
  v_uid uuid;
  v_has_mfa boolean;
BEGIN
  -- Service role bypasses MFA check
  v_role := auth.jwt() ->> 'role';
  IF v_role = 'service_role' THEN
    RETURN true;
  END IF;

  -- If token has aal2, MFA challenge was completed and verified
  v_aal := auth.jwt() ->> 'aal';
  IF v_aal = 'aal2' THEN
    RETURN true;
  END IF;

  -- Caller's user ID
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Check if user has an active/verified MFA factor enrolled
  IF to_regclass('auth.mfa_factors') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM auth.mfa_factors
       WHERE user_id = v_uid
         AND status = 'verified'
    ) INTO v_has_mfa;

    -- If user has active MFA enrolled, require them to finish the MFA challenge (aal2)
    IF v_has_mfa THEN
      RETURN false;
    END IF;
  END IF;

  -- User does not have MFA enabled: aal1 session is fully authorized
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.is_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_aal2() TO authenticated, service_role;

