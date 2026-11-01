-- Replace the unscoped upload rule on portal-assets with one tied to the
-- uploader's own tenant folder and their tenant_admin (or super admin) role.
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
  AND (
    public.is_super_admin((SELECT auth.uid()))
    OR public.has_tenant_role(
         (SELECT auth.uid()),
         ((storage.foldername(name))[1])::uuid,
         ARRAY['tenant_admin']::public.app_role[]
       )
  )
);