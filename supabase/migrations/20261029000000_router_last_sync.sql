-- When the router's sync script was last generated (the database snapshot it was built from).
-- Lets the captive portal wait until a freshly redeemed voucher has actually reached the router
-- before sending the customer to the hotspot login.
ALTER TABLE public.routers ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;
