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
  v_profile_exists boolean;
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

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id
  ) INTO v_profile_exists;

  IF NOT v_profile_exists THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF p_role = 'super_admin' THEN
    v_tenant := NULL;
  ELSE
    IF v_tenant IS NULL THEN
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

  UPDATE public.profiles
  SET tenant_id = v_tenant
  WHERE id = p_user_id;

  DELETE FROM public.user_roles
  WHERE user_id = p_user_id
    AND role = p_role
    AND tenant_id IS NOT DISTINCT FROM v_tenant;

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (p_user_id, p_role, v_tenant);

  RETURN COALESCE(v_tenant, p_user_id);
END;
$$;