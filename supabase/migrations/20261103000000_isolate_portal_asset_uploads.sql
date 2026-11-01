-- Limit authenticated portal image uploads to a tenant-admin's own tenant and user folder.
-- RESTRICTIVE ensures this check also applies alongside any existing permissive storage policy.
DROP POLICY IF EXISTS "portal assets tenant user uploads" ON storage.objects;
CREATE POLICY "portal assets tenant user uploads"
  ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN bucket_id <> 'portal-assets' THEN true
      WHEN array_length(storage.foldername(name), 1) < 2 THEN false
      WHEN (storage.foldername(name))[2] <> auth.uid()::text THEN false
      WHEN (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
      WHEN public.is_super_admin(auth.uid()) THEN true
      ELSE public.has_tenant_role(
        auth.uid(),
        ((storage.foldername(name))[1])::uuid,
        ARRAY['tenant_admin']::public.app_role[]
      )
    END
  );

DROP POLICY IF EXISTS "portal assets tenant user updates" ON storage.objects;
CREATE POLICY "portal assets tenant user updates"
  ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (
    CASE
      WHEN bucket_id <> 'portal-assets' THEN true
      WHEN array_length(storage.foldername(name), 1) < 2 THEN false
      WHEN (storage.foldername(name))[2] <> auth.uid()::text THEN false
      WHEN (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
      WHEN public.is_super_admin(auth.uid()) THEN true
      ELSE public.has_tenant_role(
        auth.uid(),
        ((storage.foldername(name))[1])::uuid,
        ARRAY['tenant_admin']::public.app_role[]
      )
    END
  )
  WITH CHECK (
    CASE
      WHEN bucket_id <> 'portal-assets' THEN true
      WHEN array_length(storage.foldername(name), 1) < 2 THEN false
      WHEN (storage.foldername(name))[2] <> auth.uid()::text THEN false
      WHEN (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
      WHEN public.is_super_admin(auth.uid()) THEN true
      ELSE public.has_tenant_role(
        auth.uid(),
        ((storage.foldername(name))[1])::uuid,
        ARRAY['tenant_admin']::public.app_role[]
      )
    END
  );
