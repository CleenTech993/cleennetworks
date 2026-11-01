-- Replace the unscoped upload rule on portal-assets with one tied to the
-- uploader's own tenant folder: the first path segment must be the tenant_id
-- from the caller's profile, so no signed-in user can upload into another
-- tenant's assets or outside the bucket.
DROP POLICY IF EXISTS "Authenticated users can upload portal assets" ON storage.objects;

CREATE POLICY "Authenticated users can upload portal assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'portal-assets'
  AND (storage.foldername(name))[1] = (
    SELECT p.tenant_id::text
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
  )
);
