-- SECURITY: authenticated users could UPDATE profiles.tenant_id on their own row
-- (policy had no WITH CHECK / column limit). Every tenant-scoped policy trusts
-- user_tenant_id(), so this allowed joining any tenant. Profiles are now created
-- by handle_new_user() and modified by SECURITY DEFINER functions only
-- (bootstrap_tenant, admin_approve_user); the only self-editable column is full_name.

DROP POLICY IF EXISTS "profiles self insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;

REVOKE INSERT, UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

CREATE POLICY "profiles self update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
