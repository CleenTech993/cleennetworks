ALTER TABLE public.routers
  ADD COLUMN IF NOT EXISTS vendor text NOT NULL DEFAULT 'mikrotik',
  ADD COLUMN IF NOT EXISTS device_family text,
  ADD COLUMN IF NOT EXISTS controller_version text,
  ADD COLUMN IF NOT EXISTS management_method text,
  ADD COLUMN IF NOT EXISTS management_status text NOT NULL DEFAULT 'api_unavailable',
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.routers
  DROP CONSTRAINT IF EXISTS routers_vendor_check;
ALTER TABLE public.routers
  ADD CONSTRAINT routers_vendor_check
  CHECK (vendor IN ('mikrotik', 'ruijie_reyee', 'tp_link_omada'));

ALTER TABLE public.routers
  DROP CONSTRAINT IF EXISTS routers_management_status_check;
ALTER TABLE public.routers
  ADD CONSTRAINT routers_management_status_check
  CHECK (management_status IN (
    'online',
    'offline',
    'partially_supported',
    'api_unavailable',
    'authentication_failed',
    'successfully_provisioned'
  ));

UPDATE public.routers
SET management_method = COALESCE(management_method, 'routeros_agent'),
    management_status = CASE
      WHEN status = 'pending' THEN 'api_unavailable'
      ELSE 'successfully_provisioned'
    END,
    device_family = COALESCE(device_family, board_name, model),
    firmware_version = COALESCE(firmware_version, routeros_version),
    capabilities = '["health.read", "interfaces.read", "pppoe.configure", "guest_portal.voucher_sync"]'::jsonb
WHERE vendor = 'mikrotik'
  AND management_method IS NULL;