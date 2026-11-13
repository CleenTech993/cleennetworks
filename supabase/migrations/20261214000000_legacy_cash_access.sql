ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS legacy_cash_access boolean NOT NULL DEFAULT false;
