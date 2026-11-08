CREATE TABLE IF NOT EXISTS public.omada_authorization_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  context_kind text NOT NULL CHECK (context_kind IN ('eap', 'gateway')),
  client_mac text NOT NULL CHECK (client_mac ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  ap_mac text,
  gateway_mac text,
  ssid_name text,
  radio_id text CHECK (radio_id IN ('0', '1')),
  vlan_id text,
  site_name text NOT NULL,
  redirect_url text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'authorized', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  authorized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omada_authorization_context_shape CHECK (
    (context_kind = 'eap' AND ap_mac IS NOT NULL AND ssid_name IS NOT NULL AND radio_id IS NOT NULL
      AND gateway_mac IS NULL AND vlan_id IS NULL)
    OR
    (context_kind = 'gateway' AND gateway_mac IS NOT NULL AND vlan_id IS NOT NULL
      AND ap_mac IS NULL AND ssid_name IS NULL AND radio_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS omada_authorization_jobs_retry_idx
  ON public.omada_authorization_jobs (status, next_attempt_at);

ALTER TABLE public.omada_authorization_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.omada_authorization_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.omada_authorization_jobs TO service_role;
