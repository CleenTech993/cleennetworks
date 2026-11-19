CREATE TABLE IF NOT EXISTS public.direct_mpesa_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shortcode text NOT NULL,
  transaction_id text NOT NULL UNIQUE,
  transaction_time timestamptz NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  bill_ref_number text,
  phone text,
  first_name text,
  middle_name text,
  last_name text,
  suggested_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'approved', 'rejected')),
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  raw_payload jsonb NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS direct_mpesa_transactions_tenant_status_time_idx
  ON public.direct_mpesa_transactions (tenant_id, status, transaction_time DESC);

ALTER TABLE public.direct_mpesa_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.direct_mpesa_transactions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.direct_mpesa_transactions FROM authenticated;
GRANT SELECT ON public.direct_mpesa_transactions TO authenticated;
GRANT ALL ON public.direct_mpesa_transactions TO service_role;

DROP POLICY IF EXISTS "direct M-Pesa transactions tenant read" ON public.direct_mpesa_transactions;
CREATE POLICY "direct M-Pesa transactions tenant read" ON public.direct_mpesa_transactions
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.user_tenant_id(auth.uid())
    OR public.is_super_admin(auth.uid())
  );

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
SET search_path TO 'public'
AS $function$
DECLARE
  v_transaction public.direct_mpesa_transactions%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_package public.packages%ROWTYPE;
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_transaction
  FROM public.direct_mpesa_transactions
  WHERE id = p_transaction_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND OR v_transaction.status <> 'received' THEN
    RAISE EXCEPTION 'This transaction is no longer awaiting review';
  END IF;

  SELECT * INTO v_customer
  FROM public.customers
  WHERE id = p_customer_id
    AND tenant_id = p_tenant_id
    AND customer_type = 'pppoe';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select a PPPoE customer belonging to this tenant';
  END IF;

  SELECT * INTO v_package
  FROM public.packages
  WHERE id = p_package_id
    AND tenant_id = p_tenant_id
    AND kind = 'pppoe'
    AND active IS TRUE;
  IF NOT FOUND
     OR v_package.price IS NULL
     OR ceil(v_package.price) <> v_transaction.amount THEN
    RAISE EXCEPTION 'The selected active PPPoE package price does not match this payment';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Invalid subscription expiry';
  END IF;

  INSERT INTO public.payments (
    tenant_id, customer_id, package_id, phone, amount, mpesa_receipt,
    status, provider, raw_callback, created_at, expires_at
  )
  VALUES (
    p_tenant_id, p_customer_id, p_package_id, v_transaction.phone,
    v_transaction.amount, v_transaction.transaction_id, 'success', 'daraja',
    v_transaction.raw_payload, v_transaction.transaction_time, p_expires_at
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.customers
  SET package_id = p_package_id,
      expires_at = p_expires_at,
      status = 'active'
  WHERE id = p_customer_id AND tenant_id = p_tenant_id;

  UPDATE public.direct_mpesa_transactions
  SET status = 'approved',
      customer_id = p_customer_id,
      payment_id = v_payment_id,
      reviewed_by = p_reviewed_by,
      reviewed_at = now()
  WHERE id = p_transaction_id;

  RETURN v_payment_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_direct_mpesa_transaction(uuid, uuid, uuid, uuid, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_direct_mpesa_transaction(uuid, uuid, uuid, uuid, timestamptz, uuid)
  TO service_role;
