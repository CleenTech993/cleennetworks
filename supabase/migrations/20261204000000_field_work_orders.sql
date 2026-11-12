CREATE TABLE IF NOT EXISTS public.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  scheduled_at timestamptz,
  resolution_notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS work_orders_tenant_status_scheduled_idx
  ON public.work_orders (tenant_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS work_orders_assignee_status_scheduled_idx
  ON public.work_orders (assigned_to, status, scheduled_at)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_orders_customer_created_idx
  ON public.work_orders (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_orders_ticket_idx
  ON public.work_orders (ticket_id)
  WHERE ticket_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_work_order_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'work order tenant cannot be changed' USING ERRCODE = '42501';
  END IF;

  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'work order customer must belong to its tenant' USING ERRCODE = '42501';
  END IF;

  IF NEW.ticket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE id = NEW.ticket_id
      AND tenant_id = NEW.tenant_id
      AND (NEW.customer_id IS NULL OR customer_id = NEW.customer_id)
  ) THEN
    RAISE EXCEPTION 'work order ticket must match its tenant and customer' USING ERRCODE = '42501';
  END IF;

  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.assigned_to
      AND tenant_id = NEW.tenant_id
      AND role IN ('tenant_admin', 'technician')
  ) THEN
    RAISE EXCEPTION 'work order assignee must be a technician or admin in its tenant'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now();
  IF NEW.status = 'completed' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.completed_at := now();
    ELSIF OLD.status <> 'completed' THEN
      NEW.completed_at := now();
    ELSE
      NEW.completed_at := OLD.completed_at;
    END IF;
  ELSIF NEW.status <> 'completed' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_work_order_scope ON public.work_orders;
CREATE TRIGGER validate_work_order_scope
  BEFORE INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_work_order_scope();
REVOKE ALL ON FUNCTION public.validate_work_order_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_work_order_scope() TO service_role;

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "work orders require aal2" ON public.work_orders;
CREATE POLICY "work orders require aal2" ON public.work_orders
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2())
  WITH CHECK (public.is_aal2());

DROP POLICY IF EXISTS "work orders read by role" ON public.work_orders;
CREATE POLICY "work orders read by role" ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin', 'support_staff']::public.app_role[]
    )
    OR (
      public.has_tenant_role(auth.uid(), tenant_id, ARRAY['technician']::public.app_role[])
      AND assigned_to = auth.uid()
    )
  );

DROP POLICY IF EXISTS "work orders insert by role" ON public.work_orders;
CREATE POLICY "work orders insert by role" ON public.work_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]
    )
    OR (
      public.has_tenant_role(auth.uid(), tenant_id, ARRAY['technician']::public.app_role[])
      AND assigned_to = auth.uid()
    )
  );

DROP POLICY IF EXISTS "work orders update by role" ON public.work_orders;
CREATE POLICY "work orders update by role" ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]
    )
    OR (
      public.has_tenant_role(auth.uid(), tenant_id, ARRAY['technician']::public.app_role[])
      AND assigned_to = auth.uid()
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[]
    )
    OR (
      public.has_tenant_role(auth.uid(), tenant_id, ARRAY['technician']::public.app_role[])
      AND assigned_to = auth.uid()
    )
  );

DROP POLICY IF EXISTS "work orders delete by role" ON public.work_orders;
CREATE POLICY "work orders delete by role" ON public.work_orders
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin']::public.app_role[])
  );

REVOKE ALL ON public.work_orders FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_orders TO authenticated;
GRANT ALL ON public.work_orders TO service_role;
