-- Remove non-Daraja payment paths. Keep completed historical records readable, but
-- fail old provider payments that were still waiting for a callback at cutover.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_provider_check;
UPDATE public.payments
SET status = 'failed'
WHERE provider IN ('intasend', 'payhero')
  AND status IN ('pending', 'processing');
ALTER TABLE public.payments
  ADD CONSTRAINT payments_provider_check
  CHECK (
    provider = 'daraja'
    OR (provider IN ('intasend', 'payhero') AND status IN ('success', 'failed'))
  );

DROP INDEX IF EXISTS public.payments_intasend_invoice_key;

ALTER TABLE public.platform_mpesa_config
  DROP CONSTRAINT IF EXISTS platform_mpesa_config_active_provider_check;
ALTER TABLE public.platform_mpesa_config
  DROP COLUMN IF EXISTS active_provider;

DROP TABLE IF EXISTS public.platform_gateway_secrets;
