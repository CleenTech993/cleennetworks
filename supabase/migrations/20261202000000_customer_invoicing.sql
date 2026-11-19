CREATE SEQUENCE IF NOT EXISTS public.customer_invoice_number_seq;

CREATE TABLE IF NOT EXISTS public.customer_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  package_name text NOT NULL,
  invoice_number text NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'overdue', 'paid', 'void')),
  service_period_start timestamptz NOT NULL,
  service_period_end timestamptz NOT NULL,
  duration_value integer NOT NULL CHECK (duration_value > 0),
  duration_unit text NOT NULL CHECK (duration_unit IN ('minutes', 'hours', 'days', 'weeks', 'months')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (service_period_end > service_period_start),
  UNIQUE (tenant_id, invoice_number)
);

ALTER TABLE public.customer_invoices
  ADD COLUMN IF NOT EXISTS duration_value integer,
  ADD COLUMN IF NOT EXISTS duration_unit text,
  ADD COLUMN IF NOT EXISTS package_name text;

UPDATE public.customer_invoices AS invoice
   SET duration_value = COALESCE(invoice.duration_value, package.duration_value),
       duration_unit = COALESCE(invoice.duration_unit, package.duration_unit),
       package_name = COALESCE(invoice.package_name, package.name)
  FROM public.packages AS package
 WHERE package.id = invoice.package_id
   AND (
     invoice.duration_value IS NULL
     OR invoice.duration_unit IS NULL
     OR invoice.package_name IS NULL
   );

ALTER TABLE public.customer_invoices
  ALTER COLUMN duration_value SET NOT NULL,
  ALTER COLUMN duration_unit SET NOT NULL,
  ALTER COLUMN package_name SET NOT NULL,
  DROP CONSTRAINT IF EXISTS customer_invoices_duration_value_check,
  DROP CONSTRAINT IF EXISTS customer_invoices_duration_unit_check,
  ADD CONSTRAINT customer_invoices_duration_value_check CHECK (duration_value > 0),
  ADD CONSTRAINT customer_invoices_duration_unit_check
    CHECK (duration_unit IN ('minutes', 'hours', 'days', 'weeks', 'months'));

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS customer_invoice_id uuid
    REFERENCES public.customer_invoices(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_invoices_customer_period_key
  ON public.customer_invoices (customer_id, service_period_start);
CREATE INDEX IF NOT EXISTS customer_invoices_tenant_status_due_idx
  ON public.customer_invoices (tenant_id, status, due_at DESC);
CREATE INDEX IF NOT EXISTS customer_invoices_customer_issued_idx
  ON public.customer_invoices (customer_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS payments_customer_invoice_idx
  ON public.payments (customer_invoice_id)
  WHERE customer_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_invoices_payment_id_key
  ON public.customer_invoices (payment_id)
  WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_single_active_invoice_payment_idx
  ON public.payments (customer_invoice_id)
  WHERE customer_invoice_id IS NOT NULL
    AND status IN ('pending', 'processing');

ALTER TABLE public.customer_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer invoices tenant billing read" ON public.customer_invoices;
CREATE POLICY "customer invoices tenant billing read" ON public.customer_invoices
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(),
      tenant_id,
      ARRAY['tenant_admin', 'billing_agent']::public.app_role[]
    )
  );
REVOKE ALL ON public.customer_invoices FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.customer_invoices FROM authenticated;
GRANT SELECT ON public.customer_invoices TO authenticated;
GRANT ALL ON public.customer_invoices TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.customer_invoice_number_seq TO service_role;

CREATE OR REPLACE FUNCTION public.generate_due_customer_invoices(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer record;
  v_period_end timestamptz;
  v_invoice_number text;
  v_count integer := 0;
BEGIN
  UPDATE public.customer_invoices
     SET status = 'overdue'
   WHERE status = 'pending'
     AND due_at <= p_now;

  FOR v_customer IN
    SELECT
      c.id,
      c.tenant_id,
      c.package_id,
      c.expires_at,
      pkg.name,
      pkg.price,
      pkg.duration_value,
      pkg.duration_unit
    FROM public.customers AS c
    JOIN public.packages AS pkg
      ON pkg.id = c.package_id
     AND pkg.tenant_id = c.tenant_id
     AND pkg.kind = 'pppoe'
    WHERE c.customer_type = 'pppoe'
      AND c.status = 'active'
      AND c.expires_at IS NOT NULL
      AND c.expires_at <= p_now
      AND pkg.price > 0
      AND pkg.duration_value > 0
      AND pkg.duration_unit IN ('minutes', 'hours', 'days', 'weeks', 'months')
      AND pkg.duration_value <= 2147483647
      AND NOT EXISTS (
        SELECT 1
          FROM public.payments AS payment
         WHERE payment.tenant_id = c.tenant_id
           AND payment.customer_id = c.id
           AND payment.status IN ('pending', 'processing')
      )
    ORDER BY c.expires_at, c.id
  LOOP
    v_period_end := v_customer.expires_at + CASE v_customer.duration_unit
      WHEN 'minutes' THEN v_customer.duration_value * interval '1 minute'
      WHEN 'hours' THEN v_customer.duration_value * interval '1 hour'
      WHEN 'days' THEN v_customer.duration_value * interval '1 day'
      WHEN 'weeks' THEN v_customer.duration_value * interval '1 week'
      WHEN 'months' THEN v_customer.duration_value * interval '30 days'
    END;
    v_invoice_number := 'C-' || to_char(p_now AT TIME ZONE 'Africa/Nairobi', 'YYYYMM')
      || '-' || lpad(nextval('public.customer_invoice_number_seq')::text, 8, '0');

    INSERT INTO public.customer_invoices (
      tenant_id, customer_id, package_id, invoice_number, amount, status,
      package_name, service_period_start, service_period_end, duration_value, duration_unit,
      issued_at, due_at
    )
    VALUES (
      v_customer.tenant_id,
      v_customer.id,
      v_customer.package_id,
      v_invoice_number,
      ceil(v_customer.price),
      'pending',
      v_customer.name,
      v_customer.expires_at,
      v_period_end,
      v_customer.duration_value,
      v_customer.duration_unit,
      p_now,
      v_customer.expires_at + interval '3 days'
    )
    ON CONFLICT (customer_id, service_period_start) DO NOTHING;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_due_customer_invoices(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_due_customer_invoices(timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_customer_invoice_payment(
  p_payment_id uuid,
  p_receipt text,
  p_raw_callback jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_invoice public.customer_invoices%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_expires_at timestamptz;
  v_updated integer;
BEGIN
  SELECT * INTO v_payment
    FROM public.payments
   WHERE id = p_payment_id
     AND status = 'processing'
     AND customer_invoice_id IS NOT NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice payment is not available for settlement';
  END IF;
  IF p_receipt IS NULL OR length(trim(p_receipt)) = 0 THEN
    RAISE EXCEPTION 'Invoice payment requires a verified receipt';
  END IF;

  SELECT * INTO v_invoice
    FROM public.customer_invoices
   WHERE id = v_payment.customer_invoice_id
     AND tenant_id = v_payment.tenant_id
     AND customer_id = v_payment.customer_id
     AND package_id = v_payment.package_id
     AND amount = v_payment.amount
     AND status IN ('pending', 'overdue')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer invoice no longer matches this payment';
  END IF;

  SELECT * INTO v_customer
    FROM public.customers
   WHERE id = v_payment.customer_id
     AND tenant_id = v_payment.tenant_id
     AND customer_type = 'pppoe'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPPoE account not found for this invoice';
  END IF;

  v_expires_at := greatest(COALESCE(v_customer.expires_at, now()), now())
    + CASE v_invoice.duration_unit
      WHEN 'minutes' THEN v_invoice.duration_value * interval '1 minute'
      WHEN 'hours' THEN v_invoice.duration_value * interval '1 hour'
      WHEN 'days' THEN v_invoice.duration_value * interval '1 day'
      WHEN 'weeks' THEN v_invoice.duration_value * interval '1 week'
      WHEN 'months' THEN v_invoice.duration_value * interval '30 days'
    END;

  UPDATE public.customers
     SET package_id = v_invoice.package_id,
         expires_at = v_expires_at,
         status = 'active'
   WHERE id = v_customer.id
     AND tenant_id = v_customer.tenant_id;

  UPDATE public.customer_invoices
     SET status = 'paid',
         paid_at = now(),
         payment_id = v_payment.id,
         service_period_start = greatest(COALESCE(v_customer.expires_at, now()), now()),
         service_period_end = v_expires_at
   WHERE id = v_payment.customer_invoice_id
     AND tenant_id = v_payment.tenant_id
     AND customer_id = v_payment.customer_id
     AND package_id = v_payment.package_id
     AND amount = v_payment.amount;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Customer invoice no longer matches this payment';
  END IF;

  UPDATE public.payments
     SET status = 'success',
         mpesa_receipt = p_receipt,
         raw_callback = p_raw_callback,
         expires_at = v_expires_at
   WHERE id = v_payment.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_customer_invoice_payment(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_customer_invoice_payment(uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.approve_direct_mpesa_transaction(
  p_transaction_id uuid,
  p_tenant_id uuid,
  p_customer_id uuid,
  p_package_id uuid,
  p_expires_at timestamptz,
  p_reviewed_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transaction public.direct_mpesa_transactions%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_package public.packages%ROWTYPE;
  v_invoice public.customer_invoices%ROWTYPE;
  v_payment_id uuid;
  v_expires_at timestamptz;
BEGIN
  SELECT * INTO v_transaction
    FROM public.direct_mpesa_transactions
   WHERE id = p_transaction_id
     AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND OR v_transaction.status <> 'received' THEN
    RAISE EXCEPTION 'This transaction is no longer awaiting review';
  END IF;

  SELECT * INTO v_customer
    FROM public.customers
   WHERE id = p_customer_id
     AND tenant_id = p_tenant_id
     AND customer_type = 'pppoe'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select a PPPoE customer belonging to this tenant';
  END IF;

  SELECT * INTO v_invoice
    FROM public.customer_invoices
   WHERE customer_id = p_customer_id
     AND tenant_id = p_tenant_id
     AND package_id = p_package_id
     AND amount = v_transaction.amount
     AND status IN ('pending', 'overdue')
   ORDER BY issued_at DESC
   LIMIT 1
   FOR UPDATE;

  SELECT * INTO v_package
    FROM public.packages
   WHERE id = p_package_id
     AND tenant_id = p_tenant_id
     AND kind = 'pppoe'
     AND (v_invoice.id IS NOT NULL OR active IS TRUE);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select an available PPPoE package belonging to this tenant';
  END IF;

  IF v_invoice.id IS NULL THEN
    IF v_package.price IS NULL OR ceil(v_package.price) <> v_transaction.amount THEN
      RAISE EXCEPTION 'The selected active PPPoE package price does not match this payment';
    END IF;
    IF p_expires_at IS NULL OR p_expires_at <= now() THEN
      RAISE EXCEPTION 'Invalid subscription expiry';
    END IF;
    v_expires_at := p_expires_at;
  ELSE
    v_expires_at := greatest(COALESCE(v_customer.expires_at, now()), now())
      + CASE v_invoice.duration_unit
        WHEN 'minutes' THEN v_invoice.duration_value * interval '1 minute'
        WHEN 'hours' THEN v_invoice.duration_value * interval '1 hour'
        WHEN 'days' THEN v_invoice.duration_value * interval '1 day'
        WHEN 'weeks' THEN v_invoice.duration_value * interval '1 week'
        WHEN 'months' THEN v_invoice.duration_value * interval '30 days'
      END;
  END IF;

  INSERT INTO public.payments (
    tenant_id, customer_id, package_id, customer_invoice_id, phone, amount,
    mpesa_receipt, status, provider, raw_callback, created_at, expires_at
  )
  VALUES (
    p_tenant_id, p_customer_id, p_package_id, v_invoice.id, v_transaction.phone,
    v_transaction.amount, v_transaction.transaction_id, 'success', 'daraja',
    v_transaction.raw_payload, v_transaction.transaction_time, v_expires_at
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.customers
     SET package_id = p_package_id,
         expires_at = v_expires_at,
         status = 'active'
   WHERE id = p_customer_id
     AND tenant_id = p_tenant_id;

  IF v_invoice.id IS NOT NULL THEN
    UPDATE public.customer_invoices
       SET status = 'paid',
           paid_at = now(),
           payment_id = v_payment_id,
           service_period_start = greatest(COALESCE(v_customer.expires_at, now()), now()),
           service_period_end = v_expires_at
     WHERE id = v_invoice.id;
  END IF;

  UPDATE public.direct_mpesa_transactions
     SET status = 'approved',
         customer_id = p_customer_id,
         payment_id = v_payment_id,
         reviewed_by = p_reviewed_by,
         reviewed_at = now()
   WHERE id = p_transaction_id;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_direct_mpesa_transaction(
  uuid, uuid, uuid, uuid, timestamptz, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_direct_mpesa_transaction(
  uuid, uuid, uuid, uuid, timestamptz, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_stale_stk_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired integer;
BEGIN
  UPDATE public.payments
     SET status = 'failed'
   WHERE created_at < now() - interval '10 minutes'
     AND (
       status = 'pending'
       OR (status = 'processing' AND customer_invoice_id IS NOT NULL)
     );

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$$;
