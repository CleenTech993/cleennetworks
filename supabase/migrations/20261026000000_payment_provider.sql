-- Support more than one payment gateway (PayHero today, IntaSend added).
--   platform_mpesa_config.active_provider : which gateway new checkouts use (super admin setting)
--   payments.provider                     : which gateway handled each payment, so webhooks and
--                                           status checks are verified with the right one
-- merchant_request_id keeps holding the gateway's own reference (PayHero reference / IntaSend invoice_id).
ALTER TABLE public.platform_mpesa_config
  ADD COLUMN IF NOT EXISTS active_provider text NOT NULL DEFAULT 'payhero'
  CONSTRAINT platform_mpesa_config_active_provider_check CHECK (active_provider IN ('payhero', 'intasend'));

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'payhero'
  CONSTRAINT payments_provider_check CHECK (provider IN ('payhero', 'intasend'));

-- One IntaSend invoice can settle only one payment, even if a webhook is replayed or forged.
CREATE UNIQUE INDEX IF NOT EXISTS payments_intasend_invoice_key
  ON public.payments (merchant_request_id)
  WHERE provider = 'intasend' AND merchant_request_id IS NOT NULL;
