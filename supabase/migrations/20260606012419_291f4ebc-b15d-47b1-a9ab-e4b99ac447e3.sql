
ALTER TABLE public.routers
  ADD COLUMN IF NOT EXISTS cpu_load integer,
  ADD COLUMN IF NOT EXISTS free_memory_mb integer,
  ADD COLUMN IF NOT EXISTS total_memory_mb integer,
  ADD COLUMN IF NOT EXISTS hdd_free_mb integer,
  ADD COLUMN IF NOT EXISTS temperature numeric,
  ADD COLUMN IF NOT EXISTS voltage numeric,
  ADD COLUMN IF NOT EXISTS board_name text,
  ADD COLUMN IF NOT EXISTS firmware_version text,
  ADD COLUMN IF NOT EXISTS architecture text,
  ADD COLUMN IF NOT EXISTS wan_ip text,
  ADD COLUMN IF NOT EXISTS lan_ip text,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

ALTER PUBLICATION supabase_realtime ADD TABLE public.routers;
ALTER TABLE public.routers REPLICA IDENTITY FULL;
