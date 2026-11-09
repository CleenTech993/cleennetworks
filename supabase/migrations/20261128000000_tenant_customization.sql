ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS ui_labels jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

GRANT UPDATE (ui_labels) ON public.tenants TO authenticated;
GRANT UPDATE (preferences) ON public.profiles TO authenticated;

CREATE TABLE IF NOT EXISTS public.tenant_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('hotspot', 'console')),
  domain text NOT NULL CHECK (
    domain = lower(domain)
    AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    AND domain !~ '^[0-9.]+$'
    AND length(domain) <= 253
  ),
  verification_token text NOT NULL DEFAULT ('netgrid-' || replace(gen_random_uuid()::text, '-', '')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_domains_domain_key
  ON public.tenant_domains (domain);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_domains_tenant_purpose_key
  ON public.tenant_domains (tenant_id, purpose);

CREATE OR REPLACE FUNCTION public.reset_tenant_domain_verification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.domain IS DISTINCT FROM OLD.domain THEN
    NEW.verified_at := NULL;
    NEW.verification_token := 'netgrid-' || replace(gen_random_uuid()::text, '-', '');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.reset_tenant_domain_verification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tenant_domains_reset_verification ON public.tenant_domains;
CREATE TRIGGER tenant_domains_reset_verification
  BEFORE UPDATE ON public.tenant_domains
  FOR EACH ROW EXECUTE FUNCTION public.reset_tenant_domain_verification();

ALTER TABLE public.tenant_domains ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON public.tenant_domains TO authenticated;
GRANT INSERT (tenant_id, purpose, domain) ON public.tenant_domains TO authenticated;
GRANT UPDATE (domain) ON public.tenant_domains TO authenticated;
GRANT ALL ON public.tenant_domains TO service_role;

DROP POLICY IF EXISTS "tenant domains admin select" ON public.tenant_domains;
CREATE POLICY "tenant domains admin select" ON public.tenant_domains
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  );

DROP POLICY IF EXISTS "tenant domains admin insert" ON public.tenant_domains;
CREATE POLICY "tenant domains admin insert" ON public.tenant_domains
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  );

DROP POLICY IF EXISTS "tenant domains admin update" ON public.tenant_domains;
CREATE POLICY "tenant domains admin update" ON public.tenant_domains
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  );

DROP POLICY IF EXISTS "tenant domains admin delete" ON public.tenant_domains;
CREATE POLICY "tenant domains admin delete" ON public.tenant_domains
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  );
