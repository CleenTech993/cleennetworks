-- Allow the IntaSend API (publishable) key to be stored alongside the secret key and webhook challenge.
-- A separate migration, because 20261028000000 may already have been applied and applied migrations are
-- never re-run. The name list is the only thing that changes.
ALTER TABLE public.platform_gateway_secrets
  DROP CONSTRAINT IF EXISTS platform_gateway_secrets_name_check;

ALTER TABLE public.platform_gateway_secrets
  ADD CONSTRAINT platform_gateway_secrets_name_check
  CHECK (name IN ('INTASEND_SECRET_KEY', 'INTASEND_PUBLISHABLE_KEY', 'INTASEND_WEBHOOK_CHALLENGE'));
