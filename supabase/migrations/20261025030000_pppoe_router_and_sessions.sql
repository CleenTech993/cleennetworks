-- PPPoE clients: one credential belongs to ONE router, and the platform learns each client's MAC.
--
-- 1. Routers report their active PPPoE sessions (username, MAC = RouterOS "caller-id", IP) every
--    2 minutes. record_pppoe_sessions() stores the latest values on the customer row, so the PPPoE
--    page can show the client's MAC and whether they are connected right now.
-- 2. A PPPoE client must be assigned to a router of its own tenant. The form used to offer
--    "All routers", which put the same credential on every router.
--
-- Existing clients with no router keep working (the router sync still serves them to every router)
-- so nobody is cut off by this migration; the console flags them so they can be assigned.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS last_mac       text,
  ADD COLUMN IF NOT EXISTS last_ip        text,
  ADD COLUMN IF NOT EXISTS last_seen_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_router_id uuid REFERENCES public.routers(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.guard_pppoe_customer()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.customer_type = 'pppoe' THEN
    IF NEW.router_id IS NULL THEN
      -- Refuse new unassigned clients, and refuse un-assigning one. pg_trigger_depth() > 1 means the
      -- change comes from the foreign key itself (ON DELETE SET NULL when a router is deleted):
      -- that must keep working, so deleting a router never fails.
      IF pg_trigger_depth() = 1 AND (TG_OP = 'INSERT' OR OLD.router_id IS NOT NULL) THEN
        RAISE EXCEPTION 'A PPPoE client must be assigned to a router' USING ERRCODE = '23514';
      END IF;
    ELSIF TG_OP = 'INSERT' OR NEW.router_id IS DISTINCT FROM OLD.router_id THEN
      IF NOT EXISTS (SELECT 1 FROM public.routers r WHERE r.id = NEW.router_id AND r.tenant_id = NEW.tenant_id) THEN
        RAISE EXCEPTION 'Router not found' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- What the router reports about a client is written by the platform only, never by the browser.
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.last_mac := NULL; NEW.last_ip := NULL; NEW.last_seen_at := NULL; NEW.last_router_id := NULL;
    ELSIF NEW.last_mac       IS DISTINCT FROM OLD.last_mac
       OR NEW.last_ip        IS DISTINCT FROM OLD.last_ip
       OR NEW.last_seen_at   IS DISTINCT FROM OLD.last_seen_at
       OR NEW.last_router_id IS DISTINCT FROM OLD.last_router_id THEN
      RAISE EXCEPTION 'Device details are reported by the router and cannot be edited' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_pppoe_customer() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS guard_pppoe_customer ON public.customers;
CREATE TRIGGER guard_pppoe_customer BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_pppoe_customer();

-- Called by the router report endpoint (service role) with
--   p_sessions = [{"username": "...", "mac": "AA:BB:CC:DD:EE:FF", "ip": "10.10.0.5"}, ...]
-- Only clients of this tenant that belong to THIS router (or are still unassigned) are updated, so a
-- credential seen on a router it is not assigned to is ignored rather than recorded. Returns how many
-- clients were updated.
CREATE OR REPLACE FUNCTION public.record_pppoe_sessions(p_router_id uuid, p_tenant_id uuid, p_sessions jsonb)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT * FROM jsonb_to_recordset(p_sessions) AS x(username text, mac text, ip text) LIMIT 500
  ), u AS (
    UPDATE public.customers c
       SET last_mac = s.mac, last_ip = s.ip, last_seen_at = now(), last_router_id = p_router_id
      FROM s
     WHERE c.tenant_id = p_tenant_id
       AND c.customer_type = 'pppoe'
       AND c.pppoe_username = s.username
       AND (c.router_id IS NULL OR c.router_id = p_router_id)
    RETURNING 1
  )
  SELECT count(*)::int FROM u
$$;
REVOKE ALL ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) TO service_role;
