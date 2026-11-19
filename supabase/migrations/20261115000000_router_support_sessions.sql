CREATE TABLE IF NOT EXISTS public.router_support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  access_count integer NOT NULL DEFAULT 0 CHECK (access_count >= 0),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS router_support_sessions_router_active_idx
  ON public.router_support_sessions (router_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS router_support_sessions_one_active_per_router_idx
  ON public.router_support_sessions (router_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.router_support_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.router_support_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.router_support_sessions TO service_role;