-- Audit logs for Super Admin and Tenant Admins
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  actor_role text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  description text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_id_idx ON public.audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON public.audit_logs (action);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Restrictive aal2 policy (respects is_aal2() so MFA-disabled accounts still have access)
DROP POLICY IF EXISTS "audit_logs require aal2" ON public.audit_logs;
CREATE POLICY "audit_logs require aal2" ON public.audit_logs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2()) WITH CHECK (public.is_aal2());

-- Super Admin can read all audit logs
DROP POLICY IF EXISTS "audit_logs super admin read" ON public.audit_logs;
CREATE POLICY "audit_logs super admin read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Tenant staff can read their own tenant's audit logs
DROP POLICY IF EXISTS "audit_logs tenant read" ON public.audit_logs;
CREATE POLICY "audit_logs tenant read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL AND (
      tenant_id = public.user_tenant_id(auth.uid()) OR
      public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician','billing_agent','support_staff']::public.app_role[])
    )
  );

-- Authenticated users can insert audit logs for their own actions / tenant
DROP POLICY IF EXISTS "audit_logs insert" ON public.audit_logs;
CREATE POLICY "audit_logs insert" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid()) OR
    tenant_id IS NULL OR
    tenant_id = public.user_tenant_id(auth.uid())
  );
