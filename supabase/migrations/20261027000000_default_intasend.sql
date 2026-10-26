-- IntaSend becomes the default payment gateway.
--   * new installs / missing config row: active_provider defaults to 'intasend'
--   * the existing platform setting is switched to IntaSend
-- Safe to deploy before the IntaSend keys exist: while INTASEND_SECRET_KEY is not set, the server
-- keeps using PayHero (resolveProvider falls back to whichever gateway is configured), and starts
-- using IntaSend as soon as the key is added. Payments already started keep the gateway recorded in
-- payments.provider, so in-flight PayHero payments still complete. To go back, pick PayHero on
-- Super admin -> Platform Payments.
ALTER TABLE public.platform_mpesa_config ALTER COLUMN active_provider SET DEFAULT 'intasend';

UPDATE public.platform_mpesa_config SET active_provider = 'intasend' WHERE active_provider <> 'intasend';
