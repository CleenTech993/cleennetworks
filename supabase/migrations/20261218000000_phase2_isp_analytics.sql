CREATE TABLE IF NOT EXISTS public.tenant_operating_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (char_length(btrim(category)) BETWEEN 1 AND 80),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  effective_month date NOT NULL CHECK (EXTRACT(DAY FROM effective_month) = 1),
  recurring_monthly boolean NOT NULL DEFAULT false,
  ends_after_month date,
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_operating_costs_end_month_check CHECK (
    ends_after_month IS NULL
    OR (
      recurring_monthly
      AND EXTRACT(DAY FROM ends_after_month) = 1
      AND ends_after_month >= effective_month
    )
  ),
  CONSTRAINT tenant_operating_costs_description_check CHECK (
    description IS NULL OR char_length(description) <= 500
  )
);

CREATE INDEX IF NOT EXISTS tenant_operating_costs_tenant_month_idx
  ON public.tenant_operating_costs (tenant_id, effective_month DESC);

ALTER TABLE public.tenant_operating_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant operating costs read" ON public.tenant_operating_costs;
CREATE POLICY "tenant operating costs read" ON public.tenant_operating_costs
  FOR SELECT TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin','billing_agent']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "tenant operating costs insert" ON public.tenant_operating_costs;
CREATE POLICY "tenant operating costs insert" ON public.tenant_operating_costs
  FOR INSERT TO authenticated WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin','billing_agent']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "tenant operating costs update" ON public.tenant_operating_costs;
CREATE POLICY "tenant operating costs update" ON public.tenant_operating_costs
  FOR UPDATE TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin','billing_agent']::public.app_role[])
    )
  ) WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin','billing_agent']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "tenant operating costs delete" ON public.tenant_operating_costs;
CREATE POLICY "tenant operating costs delete" ON public.tenant_operating_costs
  FOR DELETE TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin','billing_agent']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "tenant operating costs require aal2" ON public.tenant_operating_costs;
CREATE POLICY "tenant operating costs require aal2" ON public.tenant_operating_costs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2())
  WITH CHECK (public.is_aal2());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_operating_costs TO authenticated;
GRANT ALL ON public.tenant_operating_costs TO service_role;

CREATE OR REPLACE FUNCTION public.tenant_revenue_by_month(
  p_tenant_id uuid,
  p_months integer DEFAULT 12
)
RETURNS TABLE (
  month date,
  revenue numeric,
  successful_payment_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    date_trunc('month', p.created_at AT TIME ZONE 'UTC')::date AS month,
    sum(p.amount)::numeric AS revenue,
    count(*)::bigint AS successful_payment_count
  FROM public.payments p
  WHERE p.tenant_id = p_tenant_id
    AND p.status = 'success'
    AND p.created_at >= (
      (
        date_trunc('month', timezone('UTC', now()))
        - make_interval(months => greatest(1, least(coalesce(p_months, 12), 24)))
      ) AT TIME ZONE 'UTC'
    )
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.tenant_revenue_by_month(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_revenue_by_month(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tenant_failed_payment_counts(
  p_tenant_id uuid,
  p_since timestamptz
)
RETURNS TABLE (
  customer_id uuid,
  unsuccessful_payment_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.customer_id, count(*)::bigint AS unsuccessful_payment_count
  FROM public.payments p
  WHERE p.tenant_id = p_tenant_id
    AND p.customer_id IS NOT NULL
    AND p.status IN ('failed', 'cancelled')
    AND p.created_at >= p_since
  GROUP BY p.customer_id
  ORDER BY p.customer_id;
$$;

REVOKE ALL ON FUNCTION public.tenant_failed_payment_counts(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_failed_payment_counts(uuid, timestamptz) TO authenticated, service_role;
