-- Router and access-point chaining, automatic MAC discovery, live per-router client counts,
-- and chain outage / discovery alerts.

-- ---------------------------------------------------------------------------------------------
-- 1. Extend public.routers with chain topology, auto-discovery, and connected client counts
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.routers
  ADD COLUMN IF NOT EXISTS node_role text NOT NULL DEFAULT 'router',
  ADD COLUMN IF NOT EXISTS parent_router_id uuid REFERENCES public.routers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discovered_by_router_id uuid REFERENCES public.routers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS uplink_interface text,
  ADD COLUMN IF NOT EXISTS auto_discovered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_chain_discovery boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS connected_clients_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hotspot_clients_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pppoe_clients_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wireless_clients_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clients_updated_at timestamptz;

ALTER TABLE public.routers
  DROP CONSTRAINT IF EXISTS routers_node_role_check;
ALTER TABLE public.routers
  ADD CONSTRAINT routers_node_role_check
  CHECK (node_role IN ('router', 'access_point'));

ALTER TABLE public.routers
  DROP CONSTRAINT IF EXISTS routers_vendor_check;
ALTER TABLE public.routers
  ADD CONSTRAINT routers_vendor_check
  CHECK (vendor IN ('mikrotik', 'ruijie_reyee', 'tp_link_omada', 'ubiquiti', 'generic'));

ALTER TABLE public.routers
  DROP CONSTRAINT IF EXISTS routers_connected_clients_nonneg_check;
ALTER TABLE public.routers
  ADD CONSTRAINT routers_connected_clients_nonneg_check
  CHECK (
    connected_clients_count >= 0
    AND hotspot_clients_count >= 0
    AND pppoe_clients_count >= 0
    AND wireless_clients_count >= 0
  );

ALTER TABLE public.routers
  DROP CONSTRAINT IF EXISTS routers_not_self_parent_check;
ALTER TABLE public.routers
  ADD CONSTRAINT routers_not_self_parent_check
  CHECK (parent_router_id IS NULL OR parent_router_id <> id);

-- Normalize existing valid MAC addresses to uppercase AA:BB:CC:DD:EE:FF before adding unique index.
UPDATE public.routers
   SET mac_address = upper(mac_address)
 WHERE mac_address IS NOT NULL
   AND mac_address ~* '^([0-9a-f]{2}:){5}[0-9a-f]{2}$'
   AND mac_address <> upper(mac_address);

CREATE INDEX IF NOT EXISTS routers_parent_idx
  ON public.routers (parent_router_id)
  WHERE parent_router_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS routers_tenant_mac_uniq
  ON public.routers (tenant_id, upper(mac_address))
  WHERE mac_address IS NOT NULL AND btrim(mac_address) <> '';

-- Guard cross-tenant chain links, MAC format, and cycle-free parent chains.
CREATE OR REPLACE FUNCTION public.routers_chain_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_cycle boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id cannot be changed' USING ERRCODE = '42501';
  END IF;

  IF NEW.mac_address IS NOT NULL THEN
    NEW.mac_address := upper(btrim(NEW.mac_address));
    IF NEW.mac_address = '' THEN
      NEW.mac_address := NULL;
    ELSIF NEW.mac_address !~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' THEN
      RAISE EXCEPTION 'Invalid MAC address format: %', NEW.mac_address USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.uplink_interface IS NOT NULL THEN
    NEW.uplink_interface := NULLIF(btrim(NEW.uplink_interface), '');
  END IF;

  IF NEW.parent_router_id IS NOT NULL THEN
    IF NEW.parent_router_id = NEW.id THEN
      RAISE EXCEPTION 'A router cannot be chained to itself' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.routers
       WHERE id = NEW.parent_router_id AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Parent router not found in this tenant' USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' THEN
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_router_id, 1 AS depth
          FROM public.routers
         WHERE id = NEW.parent_router_id
        UNION ALL
        SELECT r.id, r.parent_router_id, a.depth + 1
          FROM public.routers r
          JOIN ancestors a ON r.id = a.parent_router_id
         WHERE a.depth < 64
      )
      SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id) INTO v_has_cycle;

      IF v_has_cycle THEN
        RAISE EXCEPTION 'Router chain cannot contain a loop' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF NEW.discovered_by_router_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.routers
     WHERE id = NEW.discovered_by_router_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Discovering router not found in this tenant' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS routers_chain_guard ON public.routers;
CREATE TRIGGER routers_chain_guard
  BEFORE INSERT OR UPDATE ON public.routers
  FOR EACH ROW EXECUTE FUNCTION public.routers_chain_guard();

-- ---------------------------------------------------------------------------------------------
-- 2. Extend inventory_alerts to cover router/chain offline, recovery, and MAC auto-discovery
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.inventory_alerts
  ADD COLUMN IF NOT EXISTS router_id uuid REFERENCES public.routers(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_alerts
  DROP CONSTRAINT IF EXISTS inventory_alerts_kind_check;
ALTER TABLE public.inventory_alerts
  ADD CONSTRAINT inventory_alerts_kind_check
  CHECK (kind IN ('device_down', 'device_up', 'low_stock', 'router_down', 'router_up', 'chain_node_discovered'));

CREATE INDEX IF NOT EXISTS inventory_alerts_router_idx
  ON public.inventory_alerts (router_id, created_at DESC)
  WHERE router_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'inventory_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_alerts;
  END IF;
END
$$;
ALTER TABLE public.inventory_alerts REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------------------------
-- 3. Update router liveness sweeper to also raise router_down alerts when a router goes silent
-- ---------------------------------------------------------------------------------------------
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
       SET status = 'offline',
           management_status = CASE
             WHEN r.management_status = 'online' THEN 'offline'
             ELSE r.management_status
           END
     WHERE r.status = 'online'
       AND COALESCE(r.last_heartbeat_at, r.last_seen_at, r.created_at) < now() - p_stale
    RETURNING r.id, r.tenant_id, r.name, r.node_role, r.mac_address, r.parent_router_id,
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
  ), alerted AS (
    INSERT INTO public.inventory_alerts (tenant_id, kind, router_id, message)
    SELECT s.tenant_id,
           'router_down',
           s.id,
           CASE
             WHEN s.node_role = 'access_point' THEN 'Access point '
             ELSE 'Router '
           END
           || s.name
           || COALESCE(' (' || s.mac_address || ')', '')
           || COALESCE(
                ' on chain under ' || (SELECT p.name FROM public.routers p WHERE p.id = s.parent_router_id),
                ''
              )
           || ' is offline (no heartbeat)'
      FROM stale s
     WHERE NOT EXISTS (
       SELECT 1 FROM public.inventory_alerts a
        WHERE a.router_id = s.id
          AND a.kind = 'router_down'
          AND a.created_at >= s.went_silent
     )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM stale;
  RETURN v_count;
END
$$;

REVOKE EXECUTE ON FUNCTION public.check_router_liveness(interval) FROM PUBLIC, anon, authenticated;
