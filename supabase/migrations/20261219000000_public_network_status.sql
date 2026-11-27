ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS public_status_enabled boolean NOT NULL DEFAULT false;
