-- Router liveness sweeper.
--
-- Routers push a heartbeat every minute (the platform cannot ping them: they sit behind
-- NAT on customer connections). Nothing used to mark a router offline when the
-- heartbeats stopped, so routers.status stayed 'online' forever and an outage was only
-- recorded after the router came back.
--
-- Every 5 minutes this job looks for routers whose last heartbeat is older than 5 minutes
-- (i.e. several consecutive missed heartbeats, so a single dropped request never
-- triggers it), flips them to 'offline' and opens a downtime event dated from the last
-- heartbeat. The heartbeat endpoint closes the event when the router reports in again.
-- Requires the router_uptime_events table (drizzle/migrations/0000_router_metrics_phase2.sql).

CREATE OR REPLACE FUNCTION public.check_router_liveness(p_stale interval DEFAULT interval '5 minutes')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    UPDATE public.routers r
       SET status = 'offline'
     WHERE r.status = 'online'
       AND COALESCE(r.last_heartbeat_at, r.last_seen_at, r.created_at) < now() - p_stale
    RETURNING r.id, r.tenant_id,
              COALESCE(r.last_heartbeat_at, r.last_seen_at, r.created_at) AS went_silent
  ), opened AS (
    INSERT INTO public.router_uptime_events (router_id, tenant_id, kind, started_at)
    SELECT s.id, s.tenant_id, 'down', s.went_silent
      FROM stale s
     WHERE NOT EXISTS (
       SELECT 1 FROM public.router_uptime_events e
        WHERE e.router_id = s.id AND e.kind = 'down' AND e.ended_at IS NULL
     )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM stale;
  RETURN v_count;
END
$$;

REVOKE EXECUTE ON FUNCTION public.check_router_liveness(interval) FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Scheduling with an existing job name replaces that job, so this is safe to re-run.
SELECT cron.schedule('router-liveness-check', '*/5 * * * *', 'SELECT public.check_router_liveness()');
