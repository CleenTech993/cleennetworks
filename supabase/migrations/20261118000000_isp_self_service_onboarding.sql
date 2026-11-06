CREATE OR REPLACE FUNCTION public.provision_isp_tenant(
  p_business_name text,
  p_phone text,
  p_full_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_email text;
  v_name text := trim(COALESCE(p_business_name, ''));
  v_phone text := trim(COALESCE(p_phone, ''));
  v_full_name text := trim(COALESCE(p_full_name, ''));
  v_slug_base text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to create your ISP workspace' USING ERRCODE = '42501';
  END IF;
  IF length(v_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Business / ISP name must be between 2 and 120 characters'
      USING ERRCODE = '22023';
  END IF;
  IF v_phone !~ '^\+?[0-9][0-9 ()-]{6,19}$' THEN
    RAISE EXCEPTION 'Enter a valid contact phone number' USING ERRCODE = '22023';
  END IF;
  IF length(v_full_name) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'Contact name must be between 2 and 100 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.tenant_id
  INTO v_tenant_id
  FROM public.profiles p
  WHERE p.id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your account profile is not ready yet' USING ERRCODE = 'P0002';
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = v_user_id
        AND ur.tenant_id = v_tenant_id
        AND ur.role = 'tenant_admin'
    ) THEN
      RETURN v_tenant_id;
    END IF;
    RAISE EXCEPTION 'Your account is already linked to a workspace' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_user_id) THEN
    RAISE EXCEPTION 'Your account already has platform access' USING ERRCODE = '23505';
  END IF;

  SELECT u.email
  INTO v_email
  FROM auth.users u
  WHERE u.id = v_user_id;

  v_slug_base := trim(both '-' FROM regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_slug_base := left(COALESCE(NULLIF(v_slug_base, ''), 'isp'), 50);
  v_tenant_id := gen_random_uuid();

  INSERT INTO public.tenants (id, name, slug, support_email, support_phone)
  VALUES (
    v_tenant_id,
    v_name,
    v_slug_base || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8),
    v_email,
    v_phone
  );

  UPDATE public.profiles
  SET tenant_id = v_tenant_id,
      full_name = v_full_name,
      phone = v_phone
  WHERE id = v_user_id;

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (v_user_id, 'tenant_admin', v_tenant_id);

  RETURN v_tenant_id;
END
$$;

REVOKE ALL ON FUNCTION public.provision_isp_tenant(text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_isp_tenant(text, text, text)
  TO authenticated;

DROP FUNCTION IF EXISTS public.update_tenant_member_roles(uuid, public.app_role[]);

CREATE OR REPLACE FUNCTION public.update_tenant_member_roles(
  p_actor_id uuid,
  p_user_id uuid,
  p_roles public.app_role[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_has_admin boolean;
  v_has_other_admin boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Tenant roles must be managed through the authenticated server action'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage tenant roles' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = p_actor_id THEN
    RAISE EXCEPTION 'You cannot change your own roles' USING ERRCODE = '42501';
  END IF;
  IF p_roles IS NULL OR cardinality(p_roles) = 0 OR array_position(p_roles, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Select at least one role' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_roles) AS requested(role)
    WHERE requested.role NOT IN ('tenant_admin', 'technician', 'billing_agent', 'support_staff')
  ) THEN
    RAISE EXCEPTION 'One or more selected roles are not tenant roles' USING ERRCODE = '22023';
  END IF;

  SELECT ur.tenant_id
  INTO v_tenant_id
  FROM public.user_roles ur
  WHERE ur.user_id = p_actor_id
    AND ur.role = 'tenant_admin'
    AND ur.tenant_id IS NOT NULL
  ORDER BY ur.tenant_id
  LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Only tenant admins can manage team roles' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id = v_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id AND ur.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Team member not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.tenant_id = v_tenant_id
      AND ur.role = 'tenant_admin'
  ) INTO v_has_admin;
  IF v_has_admin AND NOT ('tenant_admin' = ANY(p_roles)) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.tenant_id = v_tenant_id
        AND ur.role = 'tenant_admin'
        AND ur.user_id <> p_user_id
    ) INTO v_has_other_admin;
    IF NOT v_has_other_admin THEN
      RAISE EXCEPTION 'A tenant must keep at least one admin' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  DELETE FROM public.user_roles ur
  WHERE ur.user_id = p_user_id
    AND ur.tenant_id = v_tenant_id;

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  SELECT p_user_id, requested.role, v_tenant_id
  FROM (SELECT DISTINCT unnest(p_roles) AS role) AS requested;
END
$$;

REVOKE ALL ON FUNCTION public.update_tenant_member_roles(uuid, uuid, public.app_role[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_tenant_member_roles(uuid, uuid, public.app_role[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.remove_tenant_member(
  p_actor_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_admin boolean;
  v_has_other_admin boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Team members must be removed through the authenticated server action'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_user_id = p_actor_id THEN
    RAISE EXCEPTION 'You cannot remove yourself' USING ERRCODE = '42501';
  END IF;

  SELECT ur.tenant_id
  INTO v_tenant_id
  FROM public.user_roles ur
  WHERE ur.user_id = p_actor_id
    AND ur.role = 'tenant_admin'
    AND ur.tenant_id IS NOT NULL
  ORDER BY ur.tenant_id
  LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Only tenant admins can manage the team' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id = v_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id AND ur.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Team member not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.tenant_id = v_tenant_id
      AND ur.role = 'tenant_admin'
  ) INTO v_is_admin;
  IF v_is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.tenant_id = v_tenant_id
        AND ur.role = 'tenant_admin'
        AND ur.user_id <> p_user_id
    ) INTO v_has_other_admin;
    IF NOT v_has_other_admin THEN
      RAISE EXCEPTION 'A tenant must keep at least one admin' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  DELETE FROM public.user_roles ur
  WHERE ur.user_id = p_user_id AND ur.tenant_id = v_tenant_id;
  UPDATE public.profiles
  SET tenant_id = NULL
  WHERE id = p_user_id AND tenant_id = v_tenant_id;
END
$$;

REVOKE ALL ON FUNCTION public.remove_tenant_member(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_tenant_member(uuid, uuid)
  TO service_role;
