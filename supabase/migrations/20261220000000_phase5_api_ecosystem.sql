CREATE TABLE IF NOT EXISTS public.tenant_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  key_prefix text NOT NULL CHECK (key_prefix ~ '^ng_[a-f0-9]{12}$'),
  key_hash text NOT NULL CHECK (char_length(key_hash) = 64),
  scopes text[] NOT NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_api_keys_scopes_check CHECK (
    scopes <@ ARRAY['static_ips:read','static_ips:write','routers:read','customers:read']::text[]
    AND cardinality(scopes) BETWEEN 1 AND 4
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_api_keys_hash_unique
  ON public.tenant_api_keys (key_hash)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_api_keys_tenant_lookup
  ON public.tenant_api_keys (tenant_id, created_at DESC);

ALTER TABLE public.tenant_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant api keys tenant admin read" ON public.tenant_api_keys;
CREATE POLICY "tenant api keys tenant admin read" ON public.tenant_api_keys
  FOR SELECT TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "tenant api keys tenant admin insert" ON public.tenant_api_keys;
CREATE POLICY "tenant api keys tenant admin insert" ON public.tenant_api_keys
  FOR INSERT TO authenticated WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "tenant api keys tenant admin update" ON public.tenant_api_keys;
CREATE POLICY "tenant api keys tenant admin update" ON public.tenant_api_keys
  FOR UPDATE TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  ) WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "tenant api keys require aal2" ON public.tenant_api_keys;
CREATE POLICY "tenant api keys require aal2" ON public.tenant_api_keys
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2())
  WITH CHECK (public.is_aal2());

GRANT SELECT, INSERT, UPDATE ON public.tenant_api_keys TO authenticated;
GRANT ALL ON public.tenant_api_keys TO service_role;

CREATE TABLE IF NOT EXISTS public.tenant_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  provider text NOT NULL CHECK (char_length(btrim(provider)) BETWEEN 1 AND 80),
  enabled boolean NOT NULL DEFAULT false,
  webhook_url text,
  webhook_secret_hash text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_integrations_webhook_check CHECK (
    webhook_url IS NULL OR webhook_url ~ '^https://'
  ),
  CONSTRAINT tenant_integrations_secret_check CHECK (
    webhook_secret_hash IS NULL OR char_length(webhook_secret_hash) = 64
  )
);

CREATE INDEX IF NOT EXISTS tenant_integrations_tenant_lookup
  ON public.tenant_integrations (tenant_id, updated_at DESC);
ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant integrations tenant admin access" ON public.tenant_integrations;
CREATE POLICY "tenant integrations tenant admin access" ON public.tenant_integrations
  FOR ALL TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  ) WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "tenant integrations require aal2" ON public.tenant_integrations;
CREATE POLICY "tenant integrations require aal2" ON public.tenant_integrations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2())
  WITH CHECK (public.is_aal2());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_integrations TO authenticated;
GRANT ALL ON public.tenant_integrations TO service_role;

CREATE TABLE IF NOT EXISTS public.tenant_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  trigger_type text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type text NOT NULL,
  action_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_automation_trigger_check CHECK (
    trigger_type IN ('router_offline','router_online','invoice_overdue','customer_expiry')
  ),
  CONSTRAINT tenant_automation_action_check CHECK (
    action_type IN ('create_ticket','create_work_order','send_webhook')
  )
);

CREATE INDEX IF NOT EXISTS tenant_automation_rules_lookup
  ON public.tenant_automation_rules (tenant_id, enabled, trigger_type);
ALTER TABLE public.tenant_automation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant automation tenant admin access" ON public.tenant_automation_rules;
CREATE POLICY "tenant automation tenant admin access" ON public.tenant_automation_rules
  FOR ALL TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  ) WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "tenant automation require aal2" ON public.tenant_automation_rules;
CREATE POLICY "tenant automation require aal2" ON public.tenant_automation_rules
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2())
  WITH CHECK (public.is_aal2());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_automation_rules TO authenticated;
GRANT ALL ON public.tenant_automation_rules TO service_role;

CREATE TABLE IF NOT EXISTS public.automation_execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.tenant_automation_rules(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('success','failed','skipped')),
  message text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_execution_log_tenant_lookup
  ON public.automation_execution_log (tenant_id, executed_at DESC);
ALTER TABLE public.automation_execution_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation execution tenant admin read" ON public.automation_execution_log;
CREATE POLICY "automation execution tenant admin read" ON public.automation_execution_log
  FOR SELECT TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin','technician']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "automation execution require aal2" ON public.automation_execution_log;
CREATE POLICY "automation execution require aal2" ON public.automation_execution_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2())
  WITH CHECK (public.is_aal2());

GRANT SELECT ON public.automation_execution_log TO authenticated;
GRANT ALL ON public.automation_execution_log TO service_role;

CREATE TABLE IF NOT EXISTS public.tenant_marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 2000),
  category text NOT NULL CHECK (char_length(btrim(category)) BETWEEN 1 AND 80),
  price numeric(14,2),
  currency text NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_marketplace_listings_active_lookup
  ON public.tenant_marketplace_listings (category, active, created_at DESC);
ALTER TABLE public.tenant_marketplace_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketplace active listings read" ON public.tenant_marketplace_listings;
CREATE POLICY "marketplace active listings read" ON public.tenant_marketplace_listings
  FOR SELECT TO authenticated USING (
    active
    AND (
      public.is_super_admin(auth.uid())
      OR tenant_id IN (
        SELECT public.tenants_with_role(ARRAY[
          'tenant_admin','technician','billing_agent','support_staff','end_user','demo_viewer'
        ]::public.app_role[])
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.tenant_id IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "marketplace tenant admin insert" ON public.tenant_marketplace_listings;
CREATE POLICY "marketplace tenant admin insert" ON public.tenant_marketplace_listings
  FOR INSERT TO authenticated WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "marketplace tenant admin update" ON public.tenant_marketplace_listings;
CREATE POLICY "marketplace tenant admin update" ON public.tenant_marketplace_listings
  FOR UPDATE TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  ) WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "marketplace listings require aal2" ON public.tenant_marketplace_listings;
CREATE POLICY "marketplace listings require aal2" ON public.tenant_marketplace_listings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2())
  WITH CHECK (public.is_aal2());

GRANT SELECT, INSERT, UPDATE ON public.tenant_marketplace_listings TO authenticated;
GRANT ALL ON public.tenant_marketplace_listings TO service_role;

CREATE TABLE IF NOT EXISTS public.tenant_marketplace_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.tenant_marketplace_listings(id) ON DELETE CASCADE,
  requester_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','accepted','declined','completed','cancelled')
  ),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_marketplace_requests_lookup
  ON public.tenant_marketplace_requests (requester_tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_marketplace_provider_lookup
  ON public.tenant_marketplace_requests (provider_tenant_id, status, created_at DESC);
ALTER TABLE public.tenant_marketplace_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketplace request tenant read" ON public.tenant_marketplace_requests;
CREATE POLICY "marketplace request tenant read" ON public.tenant_marketplace_requests
  FOR SELECT TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR requester_tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin','support_staff']::public.app_role[])
    )
    OR provider_tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin','support_staff']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "marketplace request tenant insert" ON public.tenant_marketplace_requests;
CREATE POLICY "marketplace request tenant insert" ON public.tenant_marketplace_requests
  FOR INSERT TO authenticated WITH CHECK (
    requester_tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin','support_staff']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "marketplace request provider update" ON public.tenant_marketplace_requests;
CREATE POLICY "marketplace request provider update" ON public.tenant_marketplace_requests
  FOR UPDATE TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR provider_tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  ) WITH CHECK (
    public.is_super_admin(auth.uid())
    OR provider_tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin','support_staff']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "marketplace requests require aal2" ON public.tenant_marketplace_requests;
CREATE POLICY "marketplace requests require aal2" ON public.tenant_marketplace_requests
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2())
  WITH CHECK (public.is_aal2());

GRANT SELECT, INSERT, UPDATE ON public.tenant_marketplace_requests TO authenticated;
GRANT ALL ON public.tenant_marketplace_requests TO service_role;
