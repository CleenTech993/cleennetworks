ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS manual_mpesa_receipt text,
  ADD COLUMN IF NOT EXISTS manual_verification_token_hash text,
  ADD COLUMN IF NOT EXISTS manual_verification_status text,
  ADD COLUMN IF NOT EXISTS manual_verification_error text,
  ADD COLUMN IF NOT EXISTS manual_verification_requested_at timestamptz;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_manual_verification_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_manual_verification_status_check
  CHECK (
    manual_verification_status IS NULL
    OR manual_verification_status IN ('pending', 'processing', 'verified', 'failed')
  );

CREATE UNIQUE INDEX IF NOT EXISTS payments_manual_mpesa_receipt_unique
  ON public.payments (manual_mpesa_receipt)
  WHERE manual_mpesa_receipt IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_manual_verification_token_hash_unique
  ON public.payments (manual_verification_token_hash)
  WHERE manual_verification_token_hash IS NOT NULL;

ALTER TABLE public.tenant_service_secrets
  DROP CONSTRAINT IF EXISTS tenant_service_secrets_name_check;
ALTER TABLE public.tenant_service_secrets
  DROP CONSTRAINT IF EXISTS tenant_service_secrets_allowed_names_check;
ALTER TABLE public.tenant_service_secrets
  DROP CONSTRAINT IF EXISTS tenant_service_secrets_business_shortcode_check;
ALTER TABLE public.tenant_service_secrets
  ADD CONSTRAINT tenant_service_secrets_allowed_names_check
  CHECK (name IN (
    'MPESA_ENV',
    'MPESA_MERCHANT_TYPE',
    'MPESA_BUSINESS_SHORTCODE',
    'MPESA_SHORTCODE',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_PASSKEY',
    'MPESA_INITIATOR_NAME',
    'MPESA_SECURITY_CREDENTIAL',
    'AT_USERNAME',
    'AT_API_KEY',
    'AT_SENDER_ID'
  ));
