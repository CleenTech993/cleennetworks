ALTER TABLE public.tenant_service_secrets
  DROP CONSTRAINT IF EXISTS tenant_service_secrets_name_check;
ALTER TABLE public.tenant_service_secrets
  DROP CONSTRAINT IF EXISTS tenant_service_secrets_allowed_names_check;

ALTER TABLE public.tenant_service_secrets
  ADD CONSTRAINT tenant_service_secrets_allowed_names_check
  CHECK (name IN (
    'MPESA_ENV',
    'MPESA_MERCHANT_TYPE',
    'MPESA_SHORTCODE',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_PASSKEY',
    'AT_USERNAME',
    'AT_API_KEY',
    'AT_SENDER_ID'
  ));