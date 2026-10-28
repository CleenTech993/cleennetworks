-- Shows which recent migrations are present in this database. Read-only: changes nothing.
-- Run in Supabase -> SQL editor. Every row should say true; any false row is missing, and
-- supabase/production-catchup.sql adds it.
SELECT item, ok AS present FROM (VALUES
  ('20261023 profile columns locked down',
     NOT has_column_privilege('authenticated', 'public.profiles', 'tenant_id', 'UPDATE')),
  ('20261024 router liveness check (function)',
     to_regprocedure('public.check_router_liveness(interval)') IS NOT NULL),
  ('20261024 unique PPPoE usernames',
     to_regclass('public.customers_tenant_pppoe_username_key') IS NOT NULL),
  ('20261024 smart TV devices',
     to_regclass('public.tv_devices') IS NOT NULL),
  ('20261024 portal themes',
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'captive_portals' AND column_name = 'theme')),
  ('20261025 role-aware access + two-step verification',
     to_regprocedure('public.has_tenant_role(uuid,uuid,public.app_role[])') IS NOT NULL
     AND to_regprocedure('public.is_aal2()') IS NOT NULL),
  ('20261025 router credentials (device tokens)  <- routers stop syncing without this',
     to_regclass('public.router_credentials') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'routers' AND column_name = 'legacy_token_auth')),
  ('20261025 device management (device limit, anti-tethering)',
     to_regclass('public.router_devices') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vouchers' AND column_name = 'bound_mac')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'routers' AND column_name = 'block_tethering')),
  ('20261025 PPPoE router + sessions',
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'last_router_id')
     AND to_regprocedure('public.record_pppoe_sessions(uuid,uuid,jsonb)') IS NOT NULL),
  ('20261025 inventory, stock and alerts',
     to_regclass('public.inventory_items') IS NOT NULL AND to_regclass('public.inventory_devices') IS NOT NULL
     AND to_regclass('public.stock_movements') IS NOT NULL AND to_regclass('public.inventory_alerts') IS NOT NULL
     AND to_regclass('public.alert_settings') IS NOT NULL),
  ('20261026 payment provider (PayHero / IntaSend)',
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_mpesa_config' AND column_name = 'active_provider')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'provider')),
  ('20261027 IntaSend as the default provider',
     COALESCE((SELECT column_default LIKE '%intasend%' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_mpesa_config' AND column_name = 'active_provider'), false)),
  ('20261028 payment credentials storage  <- "Could not save the credential" without this',
     to_regclass('public.platform_gateway_secrets') IS NOT NULL),
  ('20261029 IntaSend publishable key',
     EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_gateway_secrets_name_check' AND pg_get_constraintdef(oid) LIKE '%INTASEND_PUBLISHABLE_KEY%')),
  ('pg_cron enabled (needed to schedule the router liveness check)',
     EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'))
) AS t(item, ok)
ORDER BY item;
