CREATE TABLE IF NOT EXISTS public.omada_integrations (
  router_id uuid PRIMARY KEY REFERENCES public.routers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  controller_host text NOT NULL,
  controller_port integer NOT NULL CHECK (controller_port IN (433, 443, 8043)),
  controller_id text NOT NULL,
  controller_version text NOT NULL,
  site_name text NOT NULL,
  operator_username text NOT NULL,
  operator_password_ciphertext text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omada_integrations_version_supported
    CHECK (controller_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);

ALTER TABLE public.omada_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.omada_integrations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.omada_integrations TO service_role;
