-- When did this router last fetch its sync script (and with it the voucher list)?
--
-- A voucher only works on a router once the router has synced it (every 2 minutes). The portal uses
-- this timestamp to hold a customer on a "preparing" screen until their brand-new voucher has reached
-- the router, instead of sending them to a login that is certain to fail.
ALTER TABLE public.routers ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;
