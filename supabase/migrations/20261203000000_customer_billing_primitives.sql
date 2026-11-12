CREATE TABLE IF NOT EXISTS public.customer_invoice_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.customer_invoices(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, payment_id)
);

CREATE TABLE IF NOT EXISTS public.customer_invoice_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.customer_invoices(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('credit', 'discount', 'fee', 'writeoff', 'manual_adjustment')),
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  note text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_invoices
  DROP CONSTRAINT IF EXISTS customer_invoices_status_check,
  ADD CONSTRAINT customer_invoices_status_check
    CHECK (status IN ('pending', 'overdue', 'partial', 'paid', 'void'));

CREATE INDEX IF NOT EXISTS customer_invoice_allocations_invoice_idx
  ON public.customer_invoice_allocations (invoice_id, allocated_at DESC);
CREATE INDEX IF NOT EXISTS customer_invoice_adjustments_invoice_idx
  ON public.customer_invoice_adjustments (invoice_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.customer_invoice_open_balance(p_invoice_id uuid)
RETURNS numeric(12,2)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    invoice.amount
    + COALESCE((
      SELECT SUM(adj.amount)
      FROM public.customer_invoice_adjustments AS adj
      WHERE adj.invoice_id = p_invoice_id
    ), 0)
    - COALESCE((
      SELECT SUM(alloc.amount)
      FROM public.customer_invoice_allocations AS alloc
      WHERE alloc.invoice_id = p_invoice_id
    ), 0)
  FROM public.customer_invoices AS invoice
  WHERE invoice.id = p_invoice_id;
$$;

REVOKE ALL ON FUNCTION public.customer_invoice_open_balance(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_invoice_open_balance(uuid)
  TO service_role;
