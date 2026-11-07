CREATE TABLE IF NOT EXISTS public.customer_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (customer_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS customer_announcements_active_window_idx
  ON public.customer_announcements (starts_at, ends_at)
  WHERE active;
CREATE INDEX IF NOT EXISTS customer_announcements_tenant_idx
  ON public.customer_announcements (tenant_id, created_at DESC)
  WHERE active;
CREATE INDEX IF NOT EXISTS customer_announcements_customer_idx
  ON public.customer_announcements (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_announcement_reads (
  announcement_id uuid NOT NULL REFERENCES public.customer_announcements(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, customer_id)
);

CREATE TABLE IF NOT EXISTS public.service_maintenance_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid REFERENCES public.routers(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  mode text NOT NULL CHECK (mode IN ('notice', 'block_new', 'block_all')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (router_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS service_maintenance_active_window_idx
  ON public.service_maintenance_windows (starts_at, ends_at)
  WHERE active;
CREATE INDEX IF NOT EXISTS service_maintenance_scope_idx
  ON public.service_maintenance_windows (tenant_id, router_id)
  WHERE active;

CREATE OR REPLACE FUNCTION public.validate_communication_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_tenant uuid;
  v_router_tenant uuid;
BEGIN
  IF TG_TABLE_NAME = 'customer_announcements' THEN
    IF NEW.customer_id IS NOT NULL THEN
      SELECT tenant_id INTO v_customer_tenant
      FROM public.customers
      WHERE id = NEW.customer_id;
      IF NOT FOUND OR NEW.tenant_id IS DISTINCT FROM v_customer_tenant THEN
        RAISE EXCEPTION 'Announcement customer must belong to its tenant';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'service_maintenance_windows' THEN
    IF NEW.router_id IS NOT NULL THEN
      SELECT tenant_id INTO v_router_tenant
      FROM public.routers
      WHERE id = NEW.router_id;
      IF NOT FOUND OR NEW.tenant_id IS DISTINCT FROM v_router_tenant THEN
        RAISE EXCEPTION 'Maintenance site must belong to its tenant';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS validate_customer_announcement_scope ON public.customer_announcements;
CREATE TRIGGER validate_customer_announcement_scope
  BEFORE INSERT OR UPDATE OF tenant_id, customer_id
  ON public.customer_announcements
  FOR EACH ROW EXECUTE FUNCTION public.validate_communication_scope();

DROP TRIGGER IF EXISTS validate_service_maintenance_scope ON public.service_maintenance_windows;
CREATE TRIGGER validate_service_maintenance_scope
  BEFORE INSERT OR UPDATE OF tenant_id, router_id
  ON public.service_maintenance_windows
  FOR EACH ROW EXECUTE FUNCTION public.validate_communication_scope();
REVOKE ALL ON FUNCTION public.validate_communication_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_communication_scope() TO service_role;

ALTER TABLE public.customer_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_maintenance_windows ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.customer_announcements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.customer_announcement_reads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.service_maintenance_windows FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_announcements TO service_role;
GRANT ALL ON public.customer_announcement_reads TO service_role;
GRANT ALL ON public.service_maintenance_windows TO service_role;
