-- Router credentials: separate the short-lived bootstrap token from the long-lived device token.
--
-- Before: routers.provision_token was BOTH the one-line command pasted into a terminal AND the
-- credential baked into the router's scheduler (heartbeat / sync / interfaces / login page URLs).
-- It was generated in the browser, never expired (provision_token_expires_at was set to +24h by the
-- UI but never checked), was readable by every tenant member, and could not be rotated.
--
-- Now
--   provision_token ...... bootstrap token, valid for 24h, only able to fetch router.rsc.
--   router_credentials ... the device token (stored as a SHA-256 hash). The server mints it when the
--                          router fetches router.rsc and embeds it in the scheduled URLs. Clients can
--                          never read it: the table has RLS on and no grants for anon / authenticated.
--   legacy_token_auth .... true for routers that already exist today, so their current scheduler URLs
--                          (which carry provision_token) keep working until they are re-provisioned.
--                          Re-provisioning (or revoking) turns it off for that router.

ALTER TABLE public.routers ADD COLUMN IF NOT EXISTS legacy_token_auth boolean NOT NULL DEFAULT false;
UPDATE public.routers SET legacy_token_auth = true WHERE provision_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.router_credentials (
  router_id  uuid PRIMARY KEY REFERENCES public.routers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.router_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.router_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.router_credentials TO service_role;

-- ---------- tokens can only be created / changed by the server ----------
-- Direct writes from the client roles are overridden (insert) or rejected (update). The SECURITY
-- DEFINER rotate function below runs as the table owner, so current_user is not 'authenticated'
-- there and it passes.
CREATE OR REPLACE FUNCTION public.guard_router_tokens()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.provision_token            := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    NEW.provision_token_expires_at := now() + interval '24 hours';
    NEW.legacy_token_auth          := false;
  ELSIF NEW.provision_token            IS DISTINCT FROM OLD.provision_token
     OR NEW.provision_token_expires_at IS DISTINCT FROM OLD.provision_token_expires_at
     OR NEW.legacy_token_auth          IS DISTINCT FROM OLD.legacy_token_auth THEN
    RAISE EXCEPTION 'Router tokens can only be changed with rotate_router_token()' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_router_tokens() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS guard_router_tokens ON public.routers;
CREATE TRIGGER guard_router_tokens BEFORE INSERT OR UPDATE ON public.routers
  FOR EACH ROW EXECUTE FUNCTION public.guard_router_tokens();

-- ---------- rotate / revoke ----------
-- Issues a new 24h bootstrap token and returns it. With p_revoke_device the router's current device
-- credential is also destroyed (and legacy auth turned off), so it stops authenticating at once:
-- use that when a token leaked. Without it the router keeps working until it is re-provisioned.
CREATE OR REPLACE FUNCTION public.rotate_router_token(p_router_id uuid, p_revoke_device boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_token  text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.routers WHERE id = p_router_id;
  IF v_tenant IS NULL
     OR NOT (public.is_super_admin(auth.uid())
             OR public.has_tenant_role(auth.uid(), v_tenant, ARRAY['tenant_admin','technician']::public.app_role[])) THEN
    RAISE EXCEPTION 'Router not found' USING ERRCODE = '42501';
  END IF;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  UPDATE public.routers
     SET provision_token = v_token,
         provision_token_expires_at = now() + interval '24 hours',
         legacy_token_auth = CASE WHEN p_revoke_device THEN false ELSE legacy_token_auth END
   WHERE id = p_router_id;

  IF p_revoke_device THEN
    DELETE FROM public.router_credentials WHERE router_id = p_router_id;
  END IF;
  RETURN v_token;
END $$;
REVOKE ALL ON FUNCTION public.rotate_router_token(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_router_token(uuid, boolean) TO authenticated;
