ALTER TABLE public.platform_mpesa_config
  ADD COLUMN IF NOT EXISTS c2b_callback_token text,
  ADD COLUMN IF NOT EXISTS c2b_registered_at timestamptz;

ALTER TABLE public.platform_commissions
  ADD COLUMN IF NOT EXISTS payment_reference text
    DEFAULT ('NG' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)));

UPDATE public.platform_commissions
SET payment_reference = 'NG' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
WHERE payment_reference IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS platform_commissions_payment_reference_key
  ON public.platform_commissions (payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.platform_mpesa_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text NOT NULL UNIQUE,
  shortcode text NOT NULL,
  bill_ref_number text,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  transaction_time timestamptz NOT NULL,
  first_name text,
  middle_name text,
  last_name text,
  commission_id uuid REFERENCES public.platform_commissions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'unmatched'
    CHECK (status IN ('matched', 'unmatched', 'amount_mismatch', 'invoice_already_paid')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_mpesa_transactions_created_at_idx
  ON public.platform_mpesa_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_mpesa_transactions_bill_ref_idx
  ON public.platform_mpesa_transactions (bill_ref_number, transaction_time DESC);

ALTER TABLE public.platform_mpesa_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_mpesa_transactions FROM PUBLIC, anon;
GRANT SELECT ON public.platform_mpesa_transactions TO authenticated;
GRANT ALL ON public.platform_mpesa_transactions TO service_role;

DROP POLICY IF EXISTS "platform mpesa transactions super read"
  ON public.platform_mpesa_transactions;
CREATE POLICY "platform mpesa transactions super read"
  ON public.platform_mpesa_transactions
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

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
    transaction_id,
    shortcode,
    bill_ref_number,
    amount,
    transaction_time,
    first_name,
    middle_name,
    last_name
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

REVOKE ALL ON FUNCTION public.record_platform_c2b_transaction(
  text, text, text, numeric, timestamptz, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_platform_c2b_transaction(
  text, text, text, numeric, timestamptz, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.reset_platform_c2b_registration_on_shortcode_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.shortcode IS DISTINCT FROM OLD.shortcode THEN
    NEW.c2b_registered_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS platform_c2b_shortcode_registration_reset
  ON public.platform_mpesa_config;
CREATE TRIGGER platform_c2b_shortcode_registration_reset
  BEFORE UPDATE OF shortcode ON public.platform_mpesa_config
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_platform_c2b_registration_on_shortcode_change();

REVOKE ALL ON FUNCTION public.reset_platform_c2b_registration_on_shortcode_change()
  FROM PUBLIC, anon, authenticated;
