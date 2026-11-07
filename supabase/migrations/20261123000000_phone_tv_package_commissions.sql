COMMENT ON COLUMN public.packages.kind IS 'hotspot|pppoe|voucher|hotspot_tv';

CREATE OR REPLACE FUNCTION public.generate_monthly_platform_commission_invoices(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_month timestamp;
  v_month timestamp;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_tenant record;
  v_existing public.platform_commissions%ROWTYPE;
  v_tracking_start timestamptz;
  v_invoice_number text;
  v_count integer := 0;
BEGIN
  v_local_month := date_trunc('month', p_now AT TIME ZONE 'Africa/Nairobi');
  SELECT commission_tracking_starts_at
  INTO v_tracking_start
  FROM public.platform_billing_config
  WHERE id = 1;

  FOR v_month IN
    SELECT DISTINCT date_trunc('month', p.created_at AT TIME ZONE 'Africa/Nairobi')
    FROM public.payments p
    JOIN public.packages pkg
      ON pkg.id = p.package_id
     AND pkg.tenant_id = p.tenant_id
    WHERE p.status = 'success'
      AND pkg.kind IN ('hotspot', 'voucher', 'hotspot_tv', 'pppoe')
      AND p.created_at >= v_tracking_start
      AND p.created_at < (v_local_month AT TIME ZONE 'Africa/Nairobi')
    ORDER BY 1
  LOOP
    v_period_start := v_month AT TIME ZONE 'Africa/Nairobi';
    v_period_end := (v_month + interval '1 month') AT TIME ZONE 'Africa/Nairobi';

    FOR v_tenant IN
      SELECT
        t.id,
        t.slug,
        COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher', 'hotspot_tv')), 0)
          ::numeric(14,2) AS hotspot_gross_amount,
        COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0)
          ::numeric(14,2) AS pppoe_gross_amount,
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher', 'hotspot_tv')), 0) * 0.02, 2)
          ::numeric(14,2) AS hotspot_commission_amount,
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0) * 0.01, 2)
          ::numeric(14,2) AS pppoe_commission_amount
      FROM public.payments p
      JOIN public.packages pkg
        ON pkg.id = p.package_id
       AND pkg.tenant_id = p.tenant_id
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.status = 'success'
        AND pkg.kind IN ('hotspot', 'voucher', 'hotspot_tv', 'pppoe')
        AND p.created_at >= GREATEST(v_period_start, v_tracking_start)
        AND p.created_at < v_period_end
      GROUP BY t.id, t.slug
      HAVING round(
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher', 'hotspot_tv')), 0) * 0.02, 2)
        + round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0) * 0.01, 2),
        0
      ) > 0
    LOOP
      v_invoice_number :=
        'INV-' || to_char(v_month, 'YYYYMM') || '-' ||
        upper(replace(v_tenant.id::text, '-', ''));

      SELECT pc.*
      INTO v_existing
      FROM public.platform_commissions pc
      WHERE pc.tenant_id = v_tenant.id
        AND pc.period_start < v_period_end
        AND pc.period_end >= v_period_start
      ORDER BY (pc.status = 'collected') DESC, pc.created_at
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        IF v_existing.status <> 'collected' AND v_existing.invoice_number IS NULL THEN
          UPDATE public.platform_commissions
          SET period_start = v_period_start,
              period_end = v_period_end,
              hotspot_gross_amount = v_tenant.hotspot_gross_amount,
              pppoe_gross_amount = v_tenant.pppoe_gross_amount,
              hotspot_commission_amount = v_tenant.hotspot_commission_amount,
              pppoe_commission_amount = v_tenant.pppoe_commission_amount,
              hotspot_commission_rate_pct = 2,
              pppoe_commission_rate_pct = 1,
              gross_amount = v_tenant.hotspot_gross_amount + v_tenant.pppoe_gross_amount,
              commission_amount = round(
                v_tenant.hotspot_commission_amount + v_tenant.pppoe_commission_amount, 0
              ),
              commission_rate_pct = NULL,
              invoice_number = COALESCE(invoice_number, v_invoice_number),
              issued_at = COALESCE(issued_at, p_now),
              due_at = COALESCE(due_at, p_now + interval '72 hours'),
              email_status = CASE
                WHEN invoice_number IS NULL THEN 'pending'
                ELSE email_status
              END
          WHERE id = v_existing.id;
          v_count := v_count + 1;
        END IF;
      ELSE
        INSERT INTO public.platform_commissions (
          tenant_id, period_start, period_end, gross_amount, commission_amount,
          commission_rate_pct, hotspot_gross_amount, pppoe_gross_amount,
          hotspot_commission_amount, pppoe_commission_amount,
          hotspot_commission_rate_pct, pppoe_commission_rate_pct,
          invoice_number, issued_at, due_at, status, email_status
        )
        VALUES (
          v_tenant.id, v_period_start, v_period_end,
          v_tenant.hotspot_gross_amount + v_tenant.pppoe_gross_amount,
          round(v_tenant.hotspot_commission_amount + v_tenant.pppoe_commission_amount, 0),
          NULL, v_tenant.hotspot_gross_amount, v_tenant.pppoe_gross_amount,
          v_tenant.hotspot_commission_amount, v_tenant.pppoe_commission_amount, 2, 1,
          v_invoice_number, p_now, p_now + interval '72 hours', 'pending', 'pending'
        )
        ON CONFLICT (tenant_id, period_start, period_end) DO NOTHING;
        IF FOUND THEN
          v_count := v_count + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END
$$;
