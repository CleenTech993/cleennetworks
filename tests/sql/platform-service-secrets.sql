DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_service_secrets'::regclass) THEN
    RAISE EXCEPTION 'platform service secrets must have RLS enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.platform_service_secrets', 'SELECT')
     OR has_table_privilege('authenticated', 'public.platform_service_secrets', 'INSERT')
     OR has_table_privilege('authenticated', 'public.platform_service_secrets', 'UPDATE')
     OR has_table_privilege('anon', 'public.platform_service_secrets', 'SELECT') THEN
    RAISE EXCEPTION 'browser roles must not have platform secret table privileges';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.platform_service_secrets', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.platform_service_secrets', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.platform_service_secrets', 'UPDATE') THEN
    RAISE EXCEPTION 'service role must manage platform service secrets';
  END IF;
END
$$;
