ALTER TABLE public.inventory_devices
  ADD COLUMN IF NOT EXISTS warranty_expires_on date;

GRANT INSERT (warranty_expires_on)
  ON public.inventory_devices TO authenticated;
GRANT UPDATE (warranty_expires_on)
  ON public.inventory_devices TO authenticated;
