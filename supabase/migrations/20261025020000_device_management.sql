-- Customer device management.
--
--  * vouchers.bound_mac   - the one device a voucher is pinned to (packages.device_limit = 1).
--                           The router sync script re-creates hotspot users every 2 minutes, so
--                           the binding lives here and is written back to the router each sync.
--  * routers.block_tethering - per-router switch for the anti-tethering rule (TTL trick). On by default.
--  * router_devices       - every device the routers report seeing on the hotspot (MAC, IP, name,
--                           which voucher/TV it belongs to, tethering suspicion, blocked flag).
--
-- Devices are written only by server code (the router's report endpoint and the block/unbind
-- server functions). Tenant staff may read their own tenant's devices.

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS bound_mac text
  CHECK (bound_mac IS NULL OR bound_mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$');

ALTER TABLE public.routers
  ADD COLUMN IF NOT EXISTS block_tethering boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.router_devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id        uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  mac              text NOT NULL CHECK (mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  ip               text,
  hostname         text,
  registered_kind  text CHECK (registered_kind IN ('voucher', 'tv')),
  voucher_code     text,
  authorized       boolean NOT NULL DEFAULT false,
  tether_suspected boolean NOT NULL DEFAULT false,
  blocked          boolean NOT NULL DEFAULT false,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (router_id, mac)
);

CREATE INDEX IF NOT EXISTS router_devices_tenant_seen_idx ON public.router_devices (tenant_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS router_devices_tenant_mac_idx ON public.router_devices (tenant_id, mac);
CREATE INDEX IF NOT EXISTS vouchers_bound_mac_idx ON public.vouchers (tenant_id, bound_mac) WHERE bound_mac IS NOT NULL;

ALTER TABLE public.router_devices ENABLE ROW LEVEL SECURITY;

-- Same rules as the other router tables: aal2 (MFA) session required, staff who work with
-- routers/customers can read. Nobody writes from the browser.
DROP POLICY IF EXISTS "router_devices require aal2" ON public.router_devices;
CREATE POLICY "router_devices require aal2" ON public.router_devices
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2()) WITH CHECK (public.is_aal2());

DROP POLICY IF EXISTS "router_devices staff read" ON public.router_devices;
CREATE POLICY "router_devices staff read" ON public.router_devices
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin(auth.uid()))
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','support_staff']::public.app_role[])
  );

GRANT SELECT ON public.router_devices TO authenticated;
GRANT ALL ON public.router_devices TO service_role;
