INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customer-documents',
  'customer-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "customer documents staff read" ON storage.objects;
CREATE POLICY "customer documents staff read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'customer-documents'
    AND public.is_aal2()
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.tenant_id::text = (storage.foldername(name))[1]
        AND (
          public.is_super_admin(auth.uid())
          OR public.has_tenant_role(
            auth.uid(),
            c.tenant_id,
            ARRAY['tenant_admin', 'technician', 'support_staff']::public.app_role[]
          )
        )
    )
  );

DROP POLICY IF EXISTS "customer documents staff upload" ON storage.objects;
CREATE POLICY "customer documents staff upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'customer-documents'
    AND public.is_aal2()
    AND owner_id = auth.uid()::text
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.tenant_id::text = (storage.foldername(name))[1]
        AND (
          public.is_super_admin(auth.uid())
          OR public.has_tenant_role(
            auth.uid(),
            c.tenant_id,
            ARRAY['tenant_admin', 'technician', 'support_staff']::public.app_role[]
          )
        )
    )
  );

DROP POLICY IF EXISTS "customer documents staff delete" ON storage.objects;
CREATE POLICY "customer documents staff delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'customer-documents'
    AND public.is_aal2()
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.tenant_id::text = (storage.foldername(name))[1]
        AND (
          public.is_super_admin(auth.uid())
          OR public.has_tenant_role(
            auth.uid(),
            c.tenant_id,
            ARRAY['tenant_admin', 'technician', 'support_staff']::public.app_role[]
          )
        )
    )
  );
