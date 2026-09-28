CREATE TABLE public.router_metrics (
  id bigserial PRIMARY KEY,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  cpu_pct integer,
  mem_pct integer,
  rx_bps bigint,
  tx_bps bigint,
  wan_latency_ms numeric,
  wan_loss_pct numeric,
  temp numeric
);
CREATE INDEX router_metrics_router_ts ON public.router_metrics (router_id, ts DESC);
GRANT SELECT ON public.router_metrics TO authenticated;
GRANT ALL ON public.router_metrics TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.router_metrics_id_seq TO service_role;
ALTER TABLE public.router_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "router_metrics tenant read" ON public.router_metrics FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE TABLE public.router_metrics_daily (
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  day date NOT NULL,
  avg_cpu numeric, max_cpu integer, avg_mem numeric, max_mem integer,
  avg_temp numeric, samples integer NOT NULL DEFAULT 0,
  PRIMARY KEY (router_id, day)
);
GRANT SELECT ON public.router_metrics_daily TO authenticated;
GRANT ALL ON public.router_metrics_daily TO service_role;
ALTER TABLE public.router_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "router_metrics_daily tenant read" ON public.router_metrics_daily FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE TABLE public.router_uptime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'down',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX router_uptime_events_router ON public.router_uptime_events (router_id, started_at DESC);
GRANT SELECT ON public.router_uptime_events TO authenticated;
GRANT ALL ON public.router_uptime_events TO service_role;
ALTER TABLE public.router_uptime_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "router_uptime_events tenant read" ON public.router_uptime_events FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.rollup_router_metrics()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.router_metrics_daily (router_id, tenant_id, day, avg_cpu, max_cpu, avg_mem, max_mem, avg_temp, samples)
  SELECT router_id, tenant_id, ts::date, avg(cpu_pct), max(cpu_pct), avg(mem_pct), max(mem_pct), avg(temp), count(*)
  FROM public.router_metrics
  WHERE ts >= (now() - interval '2 days')::date AND ts < now()::date
  GROUP BY router_id, tenant_id, ts::date
  ON CONFLICT (router_id, day) DO UPDATE SET
    avg_cpu = EXCLUDED.avg_cpu, max_cpu = EXCLUDED.max_cpu, avg_mem = EXCLUDED.avg_mem,
    max_mem = EXCLUDED.max_mem, avg_temp = EXCLUDED.avg_temp, samples = EXCLUDED.samples;
  DELETE FROM public.router_metrics WHERE ts < now() - interval '30 days';
  DELETE FROM public.router_metrics_daily WHERE day < (now() - interval '24 months')::date;
END $$;
REVOKE EXECUTE ON FUNCTION public.rollup_router_metrics() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('rollup-router-metrics', '15 0 * * *', 'SELECT public.rollup_router_metrics()');