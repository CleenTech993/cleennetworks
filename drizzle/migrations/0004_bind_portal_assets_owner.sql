-- Portal-assets uploads must be bound to their owner AND to the caller's tenant:
-- Storage sets owner_id from the uploader's session, and the first path folder must be the
-- caller's tenant_id, so tenants cannot write into each other's portal folders.
DROP POLICY IF EXISTS "Authenticated users can upload portal assets" ON storage.objects;
CREATE POLICY "Authenticated users can upload portal assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'portal-assets'
    AND owner_id = (SELECT auth.uid()::text)
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text
      FROM public.profiles p
      WHERE p.id = auth.uid()
    )
  );
