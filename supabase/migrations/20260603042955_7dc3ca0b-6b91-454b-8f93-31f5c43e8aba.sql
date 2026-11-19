
-- 1. Drop permissive policies
DROP POLICY IF EXISTS "tenants signup insert" ON public.tenants;
DROP POLICY IF EXISTS "roles self insert tenant_admin" ON public.user_roles;

-- 2. Secure bootstrap function: create tenant + assign caller as tenant_admin atomically
CREATE OR REPLACE FUNCTION public.bootstrap_tenant(p_name text, p_slug text, p_full_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_tenant_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 OR length(p_name) > 200 THEN
    RAISE EXCEPTION 'Invalid tenant name';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9-]{3,60}$' THEN
    RAISE EXCEPTION 'Invalid tenant slug';
  END IF;

  SELECT tenant_id INTO v_existing FROM public.profiles WHERE id = v_uid;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'User already belongs to a tenant';
  END IF;

  -- Also block if caller already has any role row
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'User already has a role assigned';
  END IF;

  INSERT INTO public.tenants (name, slug)
  VALUES (btrim(p_name), p_slug)
  RETURNING id INTO v_tenant_id;

  UPDATE public.profiles
  SET tenant_id = v_tenant_id,
      full_name = COALESCE(NULLIF(btrim(p_full_name), ''), full_name)
  WHERE id = v_uid;

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (v_uid, 'tenant_admin', v_tenant_id);

  RETURN v_tenant_id;
END;
$$;

-- 3. Lock down EXECUTE on SECURITY DEFINER helpers (no anon / public)
REVOKE ALL ON FUNCTION public.bootstrap_tenant(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_tenant(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.user_tenant_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_tenant_id(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
