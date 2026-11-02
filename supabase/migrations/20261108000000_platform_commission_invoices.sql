ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS billing_suspended_at timestamptz;

CREATE OR REPLACE FUNCTION public.protect_tenant_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.slug IS DISTINCT FROM OLD.slug
       OR NEW.subdomain IS DISTINCT FROM OLD.subdomain
       OR NEW.platform_commission_pct IS DISTINCT FROM OLD.platform_commission_pct
       OR NEW.billing_suspended_at IS DISTINCT FROM OLD.billing_suspended_at
       OR NEW.mpesa_shortcode IS DISTINCT FROM OLD.mpesa_shortcode
       OR NEW.mpesa_consumer_key IS DISTINCT FROM OLD.mpesa_consumer_key
       OR NEW.mpesa_consumer_secret IS DISTINCT FROM OLD.mpesa_consumer_secret
       OR NEW.mpesa_passkey IS DISTINCT FROM OLD.mpesa_passkey
       OR NEW.mpesa_env IS DISTINCT FROM OLD.mpesa_env
    THEN
      RAISE EXCEPTION 'Only platform admins can change this field' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.platform_billing_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  commission_tracking_starts_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_billing_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.platform_billing_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_billing_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_billing_config TO service_role;

ALTER TABLE public.platform_commissions
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS commission_rate_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_error text,
  ADD COLUMN IF NOT EXISTS email_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

ALTER TABLE public.platform_commissions
  DROP CONSTRAINT IF EXISTS platform_commissions_email_status_check;
ALTER TABLE public.platform_commissions
  ADD CONSTRAINT platform_commissions_email_status_check
  CHECK (email_status IN ('pending', 'sending', 'sent', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS platform_commissions_invoice_number_key
  ON public.platform_commissions (invoice_number)
  WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_commissions_overdue_idx
  ON public.platform_commissions (due_at, tenant_id)
  WHERE status = 'pending' AND due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_commissions_email_queue_idx
  ON public.platform_commissions (email_status, created_at)
  WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_success_created_at_idx
  ON public.payments (created_at, tenant_id)
  WHERE status = 'success';

DROP POLICY IF EXISTS "platform commissions tenant billing read" ON public.platform_commissions;
CREATE POLICY "platform commissions tenant billing read" ON public.platform_commissions
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.user_tenant_id(auth.uid())
    OR public.is_super_admin(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.generate_monthly_platform_commission_invoices(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_month timestamp;
  v_month timestamp;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_tenant record;
  v_existing public.platform_commissions%ROWTYPE;
  v_tracking_start timestamptz;
  v_invoice_number text;
  v_count integer := 0;
BEGIN
  v_local_month := date_trunc('month', p_now AT TIME ZONE 'Africa/Nairobi');
  SELECT commission_tracking_starts_at
  INTO v_tracking_start
  FROM public.platform_billing_config
  WHERE id = 1;

  FOR v_month IN
    SELECT DISTINCT date_trunc('month', p.created_at AT TIME ZONE 'Africa/Nairobi')
    FROM public.payments p
    WHERE p.status = 'success'
      AND p.created_at >= v_tracking_start
      AND p.created_at < (v_local_month AT TIME ZONE 'Africa/Nairobi')
    ORDER BY 1
  LOOP
    v_period_start := v_month AT TIME ZONE 'Africa/Nairobi';
    v_period_end := (v_month + interval '1 month') AT TIME ZONE 'Africa/Nairobi';

    FOR v_tenant IN
      SELECT
        t.id,
        t.slug,
        t.platform_commission_pct,
        sum(p.amount)::numeric(14,2) AS gross_amount,
        round(sum(p.amount) * t.platform_commission_pct / 100, 2)::numeric(14,2)
          AS commission_amount
      FROM public.payments p
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.status = 'success'
        AND p.created_at >= GREATEST(v_period_start, v_tracking_start)
        AND p.created_at < v_period_end
      GROUP BY t.id, t.slug, t.platform_commission_pct
      HAVING round(sum(p.amount) * t.platform_commission_pct / 100, 2) > 0
    LOOP
      v_invoice_number :=
        'INV-' || to_char(v_month, 'YYYYMM') || '-' ||
        upper(replace(v_tenant.id::text, '-', ''));

      SELECT pc.*
      INTO v_existing
      FROM public.platform_commissions pc
      WHERE pc.tenant_id = v_tenant.id
        AND pc.period_start < v_period_end
        AND pc.period_end >= v_period_start
      ORDER BY (pc.status = 'collected') DESC, pc.created_at
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        IF v_existing.status <> 'collected' AND v_existing.invoice_number IS NULL THEN
          UPDATE public.platform_commissions
          SET period_start = v_period_start,
              period_end = v_period_end,
              gross_amount = v_tenant.gross_amount,
              commission_amount = v_tenant.commission_amount,
              commission_rate_pct = v_tenant.platform_commission_pct,
              invoice_number = COALESCE(invoice_number, v_invoice_number),
              issued_at = COALESCE(issued_at, p_now),
              due_at = COALESCE(due_at, p_now + interval '72 hours'),
              email_status = CASE
                WHEN invoice_number IS NULL THEN 'pending'
                ELSE email_status
              END
          WHERE id = v_existing.id;
          v_count := v_count + 1;
        END IF;
      ELSE
        INSERT INTO public.platform_commissions (
          tenant_id,
          period_start,
          period_end,
          gross_amount,
          commission_amount,
          commission_rate_pct,
          invoice_number,
          issued_at,
          due_at,
          status,
          email_status
        )
        VALUES (
          v_tenant.id,
          v_period_start,
          v_period_end,
          v_tenant.gross_amount,
          v_tenant.commission_amount,
          v_tenant.platform_commission_pct,
          v_invoice_number,
          p_now,
          p_now + interval '72 hours',
          'pending',
          'pending'
        )
        ON CONFLICT (tenant_id, period_start, period_end) DO NOTHING;
        IF FOUND THEN
          v_count := v_count + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION public.refresh_overdue_tenant_billing(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.tenants t
  SET billing_suspended_at = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.platform_commissions pc
      WHERE pc.tenant_id = t.id
        AND pc.status = 'pending'
        AND pc.due_at IS NOT NULL
        AND pc.due_at <= p_now
    ) THEN COALESCE(t.billing_suspended_at, p_now)
    ELSE NULL
  END
  WHERE t.billing_suspended_at IS DISTINCT FROM CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.platform_commissions pc
      WHERE pc.tenant_id = t.id
        AND pc.status = 'pending'
        AND pc.due_at IS NOT NULL
        AND pc.due_at <= p_now
    ) THEN COALESCE(t.billing_suspended_at, p_now)
    ELSE NULL
  END;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION public.claim_platform_invoice_emails(
  p_limit integer DEFAULT 50,
  p_now timestamptz DEFAULT now()
)
RETURNS SETOF public.platform_commissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT pc.id
    FROM public.platform_commissions pc
    WHERE pc.invoice_number IS NOT NULL
      AND (
        pc.email_status IN ('pending', 'failed')
        OR (pc.email_status = 'sending' AND pc.email_attempted_at < p_now - interval '30 minutes')
      )
    ORDER BY pc.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.platform_commissions pc
  SET email_status = 'sending',
      email_error = NULL,
      email_attempted_at = p_now
  FROM candidates c
  WHERE pc.id = c.id
  RETURNING pc.*;
END
$$;

CREATE OR REPLACE FUNCTION public.refresh_billing_after_commission_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_overdue_tenant_billing();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS platform_commissions_refresh_billing ON public.platform_commissions;
CREATE TRIGGER platform_commissions_refresh_billing
  AFTER UPDATE OF status ON public.platform_commissions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.refresh_billing_after_commission_update();

CREATE OR REPLACE FUNCTION public.enforce_tenant_billing_service_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_restricted boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT t.status = 'suspended' OR t.billing_suspended_at IS NOT NULL
  INTO v_restricted
  FROM public.tenants t
  WHERE t.id = NEW.tenant_id;

  IF COALESCE(v_restricted, false) THEN
    RAISE EXCEPTION 'Tenant customer service is paused while its commission invoice is overdue'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS customers_require_current_tenant_billing ON public.customers;
CREATE TRIGGER customers_require_current_tenant_billing
  BEFORE INSERT OR UPDATE OF status ON public.customers
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.enforce_tenant_billing_service_access();

DROP TRIGGER IF EXISTS vouchers_require_current_tenant_billing ON public.vouchers;
CREATE TRIGGER vouchers_require_current_tenant_billing
  BEFORE INSERT OR UPDATE OF status ON public.vouchers
  FOR EACH ROW
  WHEN (NEW.status IN ('unused', 'used'))
  EXECUTE FUNCTION public.enforce_tenant_billing_service_access();

DROP TRIGGER IF EXISTS tv_devices_require_current_tenant_billing ON public.tv_devices;
CREATE TRIGGER tv_devices_require_current_tenant_billing
  BEFORE INSERT OR UPDATE OF status ON public.tv_devices
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.enforce_tenant_billing_service_access();

REVOKE ALL ON FUNCTION public.generate_monthly_platform_commission_invoices(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_overdue_tenant_billing(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_platform_invoice_emails(integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_billing_after_commission_update()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_tenant_billing_service_access()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_monthly_platform_commission_invoices(timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_overdue_tenant_billing(timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_platform_invoice_emails(integer, timestamptz)
  TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE OR REPLACE FUNCTION public.invoke_platform_billing_job()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_app_url text;
  v_cron_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_app_url
  FROM vault.decrypted_secrets
  WHERE name = 'platform_billing_app_url'
  ORDER BY updated_at DESC
  LIMIT 1;

  SELECT decrypted_secret INTO v_cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'platform_billing_cron_secret'
  ORDER BY updated_at DESC
  LIMIT 1;

  IF COALESCE(v_app_url, '') = '' OR COALESCE(v_cron_secret, '') = '' THEN
    RAISE WARNING 'Platform billing job is not configured; add the app URL and cron secret to Supabase Vault';
    RETURN NULL;
  END IF;

  v_request_id := net.http_post(
    url := rtrim(v_app_url, '/') || '/api/cron/platform-billing',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || v_cron_secret
    ),
    timeout_milliseconds := 30000
  );
  RETURN v_request_id;
END
$$;

REVOKE ALL ON FUNCTION public.invoke_platform_billing_job() FROM PUBLIC, anon, authenticated;
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'platform-billing-invoices';
SELECT cron.schedule(
  'platform-billing-invoices',
  '*/15 * * * *',
  'SELECT public.invoke_platform_billing_job()'
);
