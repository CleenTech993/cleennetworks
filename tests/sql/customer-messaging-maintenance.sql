DO $$
DECLARE
  v_tenant uuid := gen_random_uuid();
  v_other_tenant uuid := gen_random_uuid();
  v_router uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_rejected boolean;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.customer_announcements'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.customer_announcement_reads'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.service_maintenance_windows'::regclass) THEN
    RAISE EXCEPTION 'communications tables must have RLS enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.customer_announcements', 'SELECT')
     OR has_table_privilege('authenticated', 'public.customer_announcements', 'INSERT')
     OR has_table_privilege('anon', 'public.service_maintenance_windows', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.customer_announcements', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.customer_announcement_reads', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.service_maintenance_windows', 'INSERT') THEN
    RAISE EXCEPTION 'communications tables must be server-only';
  END IF;

  INSERT INTO public.tenants (id, name, slug)
  VALUES
    (v_tenant, 'Communications Test', 'communications-' || substr(v_tenant::text, 1, 8)),
    (v_other_tenant, 'Other Communications Test', 'other-communications-' || substr(v_other_tenant::text, 1, 8));
  INSERT INTO public.routers (id, tenant_id, name)
  VALUES (v_router, v_tenant, 'Communications site');
  INSERT INTO public.customers (id, tenant_id, email, status)
  VALUES (v_customer, v_tenant, 'customer@example.test', 'inactive');

  INSERT INTO public.customer_announcements (tenant_id, customer_id, title, body)
  VALUES (v_tenant, v_customer, 'Account update', 'A message for one customer');
  INSERT INTO public.customer_announcements (tenant_id, title, body)
  VALUES (v_tenant, 'Provider update', 'A broadcast for the tenant');
  INSERT INTO public.customer_announcements (title, body)
  VALUES ('Platform update', 'A platform-wide broadcast');
  INSERT INTO public.service_maintenance_windows (tenant_id, router_id, title, body, mode)
  VALUES (v_tenant, v_router, 'Site work', 'Work at one router site', 'block_new');
  INSERT INTO public.service_maintenance_windows (title, body, mode)
  VALUES ('Platform work', 'Platform-wide work', 'notice');

  v_rejected := false;
  BEGIN
    INSERT INTO public.customer_announcements (tenant_id, customer_id, title, body)
    VALUES (v_other_tenant, v_customer, 'Invalid target', 'Must be rejected');
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'announcement accepted a customer from another tenant';
  END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO public.service_maintenance_windows (tenant_id, router_id, title, body, mode)
    VALUES (v_other_tenant, v_router, 'Invalid site', 'Must be rejected', 'notice');
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'maintenance accepted a site from another tenant';
  END IF;
END
$$;
