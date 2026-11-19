-- When the router's sync script was last generated for it (the database snapshot it was built from).
-- Shown on the router page so it is obvious whether a router is receiving vouchers and PPPoE users:
-- "never" or "days ago" means customers created since then cannot connect.
ALTER TABLE public.routers ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;
