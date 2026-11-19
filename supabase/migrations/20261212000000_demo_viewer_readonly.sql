CREATE OR REPLACE FUNCTION public.is_demo_tenant(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = p_tenant_id
      AND t.is_demo
  )
$$;

REVOKE ALL ON FUNCTION public.is_demo_tenant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_demo_tenant(uuid) TO authenticated;

DO $$
DECLARE
  v_table record;
  v_policy record;
BEGIN
  FOR v_table IN
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      v_table.relname
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'demo viewer read ' || v_table.relname,
      v_table.relname
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ('
      'public.is_demo_tenant(tenant_id) AND public.has_tenant_role('
      'auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[]))',
      'demo viewer read ' || v_table.relname,
      v_table.relname
    );

    FOR v_policy IN
      SELECT * FROM (VALUES
        ('INSERT', 'WITH CHECK (NOT (public.is_demo_tenant(tenant_id) AND public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[])))'),
        ('UPDATE', 'USING (NOT (public.is_demo_tenant(tenant_id) AND public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[]))) WITH CHECK (NOT (public.is_demo_tenant(tenant_id) AND public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[])))'),
        ('DELETE', 'USING (NOT (public.is_demo_tenant(tenant_id) AND public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[])))')
      ) AS policies(command, clause)
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        'demo viewer deny ' || lower(v_policy.command) || ' ' || v_table.relname,
        v_table.relname
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',
        'demo viewer deny ' || lower(v_policy.command) || ' ' || v_table.relname,
        v_table.relname,
        v_policy.command,
        v_policy.clause
      );
    END LOOP;
  END LOOP;

  DROP POLICY IF EXISTS "demo viewer read tenant" ON public.tenants;
  CREATE POLICY "demo viewer read tenant" ON public.tenants
    FOR SELECT TO authenticated
    USING (
      is_demo
      AND public.has_tenant_role(
        auth.uid(), id, ARRAY['demo_viewer']::public.app_role[]
      )
    );

  FOR v_policy IN
    SELECT p.polname, p.polcmd, c.relname
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND p.polname LIKE '% require aal2'
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'tenant_id'
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
  LOOP
    IF v_policy.polcmd IN ('*', 'w') THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING (public.is_aal2() OR ('
        'public.is_demo_tenant(tenant_id) AND public.has_tenant_role('
        'auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[]))) '
        'WITH CHECK (public.is_aal2())',
        v_policy.polname,
        v_policy.relname
      );
    ELSIF v_policy.polcmd IN ('r', 'd') THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING (public.is_aal2() OR ('
        'public.is_demo_tenant(tenant_id) AND public.has_tenant_role('
        'auth.uid(), tenant_id, ARRAY[''demo_viewer'']::public.app_role[])))',
        v_policy.polname,
        v_policy.relname
      );
    ELSIF v_policy.polcmd = 'a' THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I WITH CHECK (public.is_aal2())',
        v_policy.polname,
        v_policy.relname
      );
    ELSE
      RAISE EXCEPTION 'Unexpected command % for AAL2 policy % on public.%',
        v_policy.polcmd, v_policy.polname, v_policy.relname;
    END IF;
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS "demo viewer deny tenant insert" ON public.tenants;
CREATE POLICY "demo viewer deny tenant insert" ON public.tenants
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.has_tenant_role(auth.uid(), id, ARRAY['demo_viewer']::public.app_role[]));
DROP POLICY IF EXISTS "demo viewer deny tenant update" ON public.tenants;
CREATE POLICY "demo viewer deny tenant update" ON public.tenants
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.has_tenant_role(auth.uid(), id, ARRAY['demo_viewer']::public.app_role[]))
  WITH CHECK (NOT public.has_tenant_role(auth.uid(), id, ARRAY['demo_viewer']::public.app_role[]));
DROP POLICY IF EXISTS "demo viewer deny tenant delete" ON public.tenants;
CREATE POLICY "demo viewer deny tenant delete" ON public.tenants
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.has_tenant_role(auth.uid(), id, ARRAY['demo_viewer']::public.app_role[]));
