-- Payment gateway credentials entered on Super admin -> Platform Payments.
--
-- Stored ENCRYPTED (AES-256-GCM, done in the server; see src/lib/gateway-secrets.server.ts) and readable
-- by NOTHING except the server's service role. RLS is on with no policies, and every grant to the browser
-- roles is revoked, so even a super admin's own session cannot SELECT it: the dashboard only ever gets
-- "is it set / last 4 characters / sandbox or live".
--
-- An INTASEND_* environment variable still works as a fallback when nothing is stored here.

CREATE TABLE IF NOT EXISTS public.platform_gateway_secrets (
  name        text PRIMARY KEY CHECK (name IN ('INTASEND_SECRET_KEY', 'INTASEND_PUBLISHABLE_KEY', 'INTASEND_WEBHOOK_CHALLENGE')),
  ciphertext  text NOT NULL,
  last4       text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

ALTER TABLE public.platform_gateway_secrets ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: with RLS on and none defined, non-service roles see no rows and can write none.

REVOKE ALL ON public.platform_gateway_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_gateway_secrets TO service_role;
