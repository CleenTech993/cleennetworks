CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    _user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id
        AND role = _role
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    _user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id
        AND role = 'super_admin'
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(
  _user_id uuid,
  _tenant_id uuid,
  _roles public.app_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    _user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.tenant_id = _tenant_id
        AND ur.role = ANY (_roles)
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.prevent_unpaid_pppoe_provisioning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_restricted_staff boolean;
BEGIN
  IF v_user_id IS NULL OR NEW.customer_type <> 'pppoe' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND ur.tenant_id = NEW.tenant_id
      AND ur.role IN ('billing_agent', 'support_staff')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND (
        ur.role = 'super_admin'
        OR (ur.tenant_id = NEW.tenant_id AND ur.role IN ('tenant_admin', 'technician'))
      )
  )
  INTO v_restricted_staff;

  IF NOT v_restricted_staff THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'Only tenant administrators can provision PPPoE service without verified payment.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      OLD.customer_type IS DISTINCT FROM NEW.customer_type
      OR OLD.status IS DISTINCT FROM NEW.status
      OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    )
  THEN
    RAISE EXCEPTION 'Only verified payment or a tenant administrator can change PPPoE service status or expiry.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_unpaid_pppoe_provisioning() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customers_prevent_unpaid_pppoe_provisioning ON public.customers;
CREATE TRIGGER customers_prevent_unpaid_pppoe_provisioning
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unpaid_pppoe_provisioning();
