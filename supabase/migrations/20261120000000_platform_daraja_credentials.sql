CREATE TABLE IF NOT EXISTS public.platform_service_secrets (
  name text PRIMARY KEY CHECK (name IN (
    'APP_BASE_URL',
    'PLATFORM_MPESA_ENV',
    'PLATFORM_MPESA_CONSUMER_KEY',
    'PLATFORM_MPESA_CONSUMER_SECRET'
  )),
  ciphertext text NOT NULL,
  last4 text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.platform_service_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_service_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_service_secrets TO service_role;
