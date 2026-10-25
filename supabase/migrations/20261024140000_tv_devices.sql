-- Smart-TV access. TVs cannot open a captive-portal page, so the customer registers the TV's
-- MAC address from their phone, pays for a plan, and the router then lets that MAC through the
-- hotspot (ip-binding type=bypassed) until the plan expires. The router sync script
-- (/api/public/router/sync/<token>) emits one binding per active, unexpired device.
--
-- Writes happen only through server code (service role): the public portal endpoint registers
-- devices and the payment callback activates them. Tenant staff can read their own devices.

CREATE TABLE IF NOT EXISTS public.tv_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  mac_address text NOT NULL CHECK (mac_address ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  name        text,
  phone       text,
  package_id  uuid REFERENCES public.packages(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'active', 'expired', 'blocked')),
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mac_address)
);

CREATE INDEX IF NOT EXISTS tv_devices_tenant_status_idx ON public.tv_devices (tenant_id, status);

ALTER TABLE public.tv_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tv_devices tenant read" ON public.tv_devices
  FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

GRANT SELECT ON public.tv_devices TO authenticated;
GRANT ALL ON public.tv_devices TO service_role;

-- Lets the payment callback know a payment is for a TV (activate the device instead of minting a voucher).
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS tv_device_id uuid REFERENCES public.tv_devices(id) ON DELETE SET NULL;
