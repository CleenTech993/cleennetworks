ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS bound_mac text;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_bound_mac_format_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_bound_mac_format_check
  CHECK (bound_mac IS NULL OR bound_mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$');

CREATE INDEX IF NOT EXISTS payments_bound_mac_idx
  ON public.payments (tenant_id, bound_mac)
  WHERE bound_mac IS NOT NULL;
