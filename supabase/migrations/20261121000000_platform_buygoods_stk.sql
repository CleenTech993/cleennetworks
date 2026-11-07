ALTER TABLE public.platform_service_secrets
  DROP CONSTRAINT IF EXISTS platform_service_secrets_name_check;
ALTER TABLE public.platform_service_secrets
  ADD CONSTRAINT platform_service_secrets_name_check
  CHECK (name IN (
    'APP_BASE_URL',
    'PLATFORM_MPESA_ENV',
    'PLATFORM_MPESA_CONSUMER_KEY',
    'PLATFORM_MPESA_CONSUMER_SECRET',
    'PLATFORM_MPESA_MERCHANT_TYPE',
    'PLATFORM_MPESA_BUSINESS_SHORTCODE',
    'PLATFORM_MPESA_PASSKEY'
  ));

ALTER TABLE public.platform_mpesa_transactions
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'c2b';
ALTER TABLE public.platform_mpesa_transactions
  DROP CONSTRAINT IF EXISTS platform_mpesa_transactions_payment_method_check;
ALTER TABLE public.platform_mpesa_transactions
  ADD CONSTRAINT platform_mpesa_transactions_payment_method_check
  CHECK (payment_method IN ('c2b', 'stk'));

CREATE TABLE IF NOT EXISTS public.platform_stk_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.platform_commissions(id) ON DELETE CASCADE,
  checkout_request_id text UNIQUE,
  merchant_request_id text,
  phone text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_stk_payments_one_pending_per_invoice
  ON public.platform_stk_payments (invoice_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS platform_stk_payments_checkout_request_idx
  ON public.platform_stk_payments (checkout_request_id)
  WHERE checkout_request_id IS NOT NULL;

ALTER TABLE public.platform_stk_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_stk_payments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_stk_payments TO service_role;

CREATE OR REPLACE FUNCTION public.record_platform_stk_transaction(
  p_checkout_request_id text,
  p_transaction_id text,
  p_shortcode text,
  p_amount numeric,
  p_transaction_time timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.platform_stk_payments%ROWTYPE;
  v_commission public.platform_commissions%ROWTYPE;
  v_transaction_id uuid;
  v_status text;
BEGIN
  SELECT *
  INTO v_payment
  FROM public.platform_stk_payments
  WHERE checkout_request_id = p_checkout_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'unmatched';
  END IF;

  SELECT *
  INTO v_commission
  FROM public.platform_commissions
  WHERE id = v_payment.invoice_id
  FOR UPDATE;

  INSERT INTO public.platform_mpesa_transactions (
    transaction_id, shortcode, bill_ref_number, amount, transaction_time,
    commission_id, status, payment_method
  )
  VALUES (
    p_transaction_id,
    p_shortcode,
    v_commission.payment_reference,
    p_amount,
    p_transaction_time,
    v_commission.id,
    'unmatched',
    'stk'
  )
  ON CONFLICT (transaction_id) DO NOTHING
  RETURNING id INTO v_transaction_id;

  IF v_transaction_id IS NULL THEN
    RETURN 'duplicate';
  END IF;

  IF v_commission.status = 'collected' THEN
    v_status := 'invoice_already_paid';
  ELSIF v_commission.commission_amount <> p_amount THEN
    v_status := 'amount_mismatch';
  ELSE
    UPDATE public.platform_commissions
    SET status = 'collected',
        mpesa_receipt = p_transaction_id,
        tenant_mpesa_receipt = p_transaction_id,
        collected_at = p_transaction_time
    WHERE id = v_commission.id
      AND status = 'pending';
    IF FOUND THEN
      v_status := 'matched';
    ELSE
      v_status := 'invoice_already_paid';
    END IF;
  END IF;

  UPDATE public.platform_mpesa_transactions
  SET status = v_status
  WHERE id = v_transaction_id;

  UPDATE public.platform_stk_payments
  SET status = 'completed', updated_at = now()
  WHERE id = v_payment.id;

  RETURN v_status;
END
$$;

CREATE OR REPLACE FUNCTION public.record_platform_c2b_transaction(
  p_transaction_id text,
  p_shortcode text,
  p_bill_ref_number text,
  p_amount numeric,
  p_transaction_time timestamptz,
  p_first_name text DEFAULT NULL,
  p_middle_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_id uuid;
  v_commission public.platform_commissions%ROWTYPE;
  v_status text;
BEGIN
  INSERT INTO public.platform_mpesa_transactions (
    transaction_id, shortcode, bill_ref_number, amount, transaction_time,
    first_name, middle_name, last_name
  )
  VALUES (
    p_transaction_id,
    p_shortcode,
    NULLIF(btrim(p_bill_ref_number), ''),
    p_amount,
    p_transaction_time,
    NULLIF(left(p_first_name, 100), ''),
    NULLIF(left(p_middle_name, 100), ''),
    NULLIF(left(p_last_name, 100), '')
  )
  ON CONFLICT (transaction_id) DO NOTHING
  RETURNING id INTO v_transaction_id;

  IF v_transaction_id IS NULL THEN
    RETURN 'duplicate';
  END IF;

  IF NULLIF(btrim(p_bill_ref_number), '') IS NULL THEN
    RETURN 'unmatched';
  END IF;

  SELECT pc.*
  INTO v_commission
  FROM public.platform_commissions pc
  WHERE pc.payment_reference = btrim(p_bill_ref_number)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'unmatched';
  END IF;

  IF v_commission.status = 'collected' THEN
    v_status := 'invoice_already_paid';
  ELSIF v_commission.commission_amount <> p_amount THEN
    v_status := 'amount_mismatch';
  ELSE
    UPDATE public.platform_commissions
    SET status = 'collected',
        mpesa_receipt = p_transaction_id,
        tenant_mpesa_receipt = p_transaction_id,
        collected_at = p_transaction_time
    WHERE id = v_commission.id
      AND status = 'pending';

    IF FOUND THEN
      v_status := 'matched';
    ELSE
      v_status := 'invoice_already_paid';
    END IF;
  END IF;

  UPDATE public.platform_mpesa_transactions
  SET status = v_status,
      commission_id = CASE
        WHEN v_status IN ('matched', 'amount_mismatch', 'invoice_already_paid')
          THEN v_commission.id
        ELSE NULL
      END
  WHERE id = v_transaction_id;

  RETURN v_status;
END
$$;

REVOKE ALL ON FUNCTION public.record_platform_stk_transaction(
  text, text, text, numeric, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_platform_stk_transaction(
  text, text, text, numeric, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_platform_stk_payment(p_checkout_request_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.platform_stk_payments
  SET status = 'failed', updated_at = now()
  WHERE checkout_request_id = p_checkout_request_id
    AND status = 'pending';
  RETURN FOUND;
END
$$;

REVOKE ALL ON FUNCTION public.fail_platform_stk_payment(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_platform_stk_payment(text) TO service_role;

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
      AND pkg.kind IN ('hotspot', 'voucher', 'pppoe')
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
        COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher')), 0)
          ::numeric(14,2) AS hotspot_gross_amount,
        COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0)
          ::numeric(14,2) AS pppoe_gross_amount,
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher')), 0) * 0.02, 2)
          ::numeric(14,2) AS hotspot_commission_amount,
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind = 'pppoe'), 0) * 0.01, 2)
          ::numeric(14,2) AS pppoe_commission_amount
      FROM public.payments p
      JOIN public.packages pkg
        ON pkg.id = p.package_id
       AND pkg.tenant_id = p.tenant_id
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.status = 'success'
        AND pkg.kind IN ('hotspot', 'voucher', 'pppoe')
        AND p.created_at >= GREATEST(v_period_start, v_tracking_start)
        AND p.created_at < v_period_end
      GROUP BY t.id, t.slug
      HAVING round(
        round(COALESCE(sum(p.amount) FILTER (WHERE pkg.kind IN ('hotspot', 'voucher')), 0) * 0.02, 2)
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

ALTER TABLE public.platform_commissions
  DROP CONSTRAINT IF EXISTS platform_commissions_tiered_amounts_check;
UPDATE public.platform_commissions
SET commission_amount = round(commission_amount, 0),
    email_status = CASE
      WHEN invoice_number IS NOT NULL THEN 'pending'
      ELSE email_status
    END,
    email_error = CASE
      WHEN invoice_number IS NOT NULL THEN NULL
      ELSE email_error
    END
WHERE status = 'pending'
  AND commission_amount <> round(commission_amount, 0);

ALTER TABLE public.platform_commissions
  ADD CONSTRAINT platform_commissions_tiered_amounts_check
  CHECK (
    (
      hotspot_gross_amount IS NULL
      AND pppoe_gross_amount IS NULL
      AND hotspot_commission_amount IS NULL
      AND pppoe_commission_amount IS NULL
      AND hotspot_commission_rate_pct IS NULL
      AND pppoe_commission_rate_pct IS NULL
    )
    OR (
      hotspot_gross_amount IS NOT NULL
      AND pppoe_gross_amount IS NOT NULL
      AND hotspot_commission_amount IS NOT NULL
      AND pppoe_commission_amount IS NOT NULL
      AND hotspot_commission_rate_pct IS NOT NULL
      AND pppoe_commission_rate_pct IS NOT NULL
      AND hotspot_commission_rate_pct = 2
      AND pppoe_commission_rate_pct = 1
      AND hotspot_gross_amount >= 0
      AND pppoe_gross_amount >= 0
      AND hotspot_commission_amount >= 0
      AND pppoe_commission_amount >= 0
      AND hotspot_commission_amount =
        round(hotspot_gross_amount * hotspot_commission_rate_pct / 100, 2)
      AND pppoe_commission_amount =
        round(pppoe_gross_amount * pppoe_commission_rate_pct / 100, 2)
      AND gross_amount = hotspot_gross_amount + pppoe_gross_amount
      AND (
        commission_amount = round(hotspot_commission_amount + pppoe_commission_amount, 0)
        OR (
          status = 'collected'
          AND commission_amount = hotspot_commission_amount + pppoe_commission_amount
        )
      )
    )
  );
