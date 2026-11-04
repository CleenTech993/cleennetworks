ALTER TABLE public.captive_portals
  ADD COLUMN IF NOT EXISTS post_login_url text;