CREATE TABLE IF NOT EXISTS public.router_hotspot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  mac text NOT NULL CHECK (mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  hostname text,
  voucher_code text NOT NULL,
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  ended_at timestamptz,
  session_uptime_seconds integer NOT NULL CHECK (session_uptime_seconds >= 0),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS router_hotspot_sessions_one_open_per_device_idx
  ON public.router_hotspot_sessions (router_id, mac)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS router_hotspot_sessions_tenant_started_idx
  ON public.router_hotspot_sessions (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS router_hotspot_sessions_tenant_voucher_idx
  ON public.router_hotspot_sessions (tenant_id, voucher_code, started_at DESC);

ALTER TABLE public.router_hotspot_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "router_hotspot_sessions require aal2" ON public.router_hotspot_sessions;
CREATE POLICY "router_hotspot_sessions require aal2"
  ON public.router_hotspot_sessions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2()) WITH CHECK (public.is_aal2());

DROP POLICY IF EXISTS "router_hotspot_sessions staff read" ON public.router_hotspot_sessions;
CREATE POLICY "router_hotspot_sessions staff read"
  ON public.router_hotspot_sessions
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin(auth.uid()))
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','support_staff']::public.app_role[])
  );

GRANT SELECT ON public.router_hotspot_sessions TO authenticated;
GRANT ALL ON public.router_hotspot_sessions TO service_role;