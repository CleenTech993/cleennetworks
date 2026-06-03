-- Super-admin approval RPC for new signups
CREATE OR REPLACE FUNCTION public.admin_approve_user(
  p_user_id uuid,
  p_role public.app_role,
  p_tenant_id uuid DEFAULT NULL,
  p_new_tenant_name text DEFAULT NULL,
  p_new_tenant_slug text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_tenant uuid := p_tenant_id;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_super_admin(v_caller) THEN
    RAISE EXCEPTION 'Only super admins can approve users';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  IF p_role = 'super_admin' THEN
    v_tenant := NULL;
  ELSE
    IF v_tenant IS NULL THEN
      -- Create a new tenant if name+slug provided
      IF p_new_tenant_name IS NULL OR length(btrim(p_new_tenant_name)) = 0 THEN
        RAISE EXCEPTION 'Tenant required for non super-admin roles';
      END IF;
      IF p_new_tenant_slug IS NULL OR p_new_tenant_slug !~ '^[a-z0-9-]{3,60}$' THEN
        RAISE EXCEPTION 'Invalid tenant slug';
      END IF;
      INSERT INTO public.tenants (name, slug)
      VALUES (btrim(p_new_tenant_name), p_new_tenant_slug)
      RETURNING id INTO v_tenant;
    END IF;
  END IF;

  -- Attach tenant to profile (clears for super_admin)
  UPDATE public.profiles SET tenant_id = v_tenant WHERE id = p_user_id;

  -- Insert role (idempotent on unique user_id+role)
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (p_user_id, p_role, v_tenant)
  ON CONFLICT (user_id, role) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

  RETURN COALESCE(v_tenant, p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_user(uuid, public.app_role, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_user(uuid, public.app_role, uuid, text, text) TO authenticated;

-- Allow super admins to read all profiles (already covered by existing policy via is_super_admin),
-- and ensure they can read user_roles for all users (existing policy covers this too).
