CREATE TABLE public.router_interfaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  running boolean NOT NULL DEFAULT false,
  disabled boolean NOT NULL DEFAULT false,
  rx_bytes bigint NOT NULL DEFAULT 0,
  tx_bytes bigint NOT NULL DEFAULT 0,
  rx_bps bigint NOT NULL DEFAULT 0,
  tx_bps bigint NOT NULL DEFAULT 0,
  rx_errors bigint NOT NULL DEFAULT 0,
  tx_errors bigint NOT NULL DEFAULT 0,
  rx_drops bigint NOT NULL DEFAULT 0,
  tx_drops bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (router_id, name)
);
GRANT SELECT ON public.router_interfaces TO authenticated;
GRANT ALL ON public.router_interfaces TO service_role;
ALTER TABLE public.router_interfaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "router_interfaces tenant read" ON public.router_interfaces FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

ALTER TABLE public.router_metrics ADD COLUMN IF NOT EXISTS dns_ok boolean;
ALTER TABLE public.router_metrics ADD COLUMN IF NOT EXISTS wan_jitter_ms numeric;

ALTER PUBLICATION supabase_realtime ADD TABLE public.router_interfaces;