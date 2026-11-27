CREATE OR REPLACE FUNCTION public.expire_customer_access(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pppoe integer;
  v_vouchers integer;
  v_tv_devices integer;
BEGIN
  UPDATE public.customers
  SET status = 'suspended'
  WHERE customer_type = 'pppoe'
    AND status = 'active'
    AND expires_at IS NOT NULL
    AND expires_at <= p_now;
  GET DIAGNOSTICS v_pppoe = ROW_COUNT;

  UPDATE public.vouchers
  SET status = 'expired'
  WHERE status IN ('unused', 'used', 'active')
    AND expires_at IS NOT NULL
    AND expires_at <= p_now;
  GET DIAGNOSTICS v_vouchers = ROW_COUNT;

  UPDATE public.tv_devices
  SET status = 'expired'
  WHERE status = 'active'
    AND expires_at IS NOT NULL
    AND expires_at <= p_now;
  GET DIAGNOSTICS v_tv_devices = ROW_COUNT;

  RETURN jsonb_build_object(
    'pppoeSuspended', v_pppoe,
    'vouchersExpired', v_vouchers,
    'tvDevicesExpired', v_tv_devices
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_customer_access(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_customer_access(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_customer_access()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.expire_customer_access(now());
$$;

REVOKE ALL ON FUNCTION public.expire_customer_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_customer_access() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    BEGIN
      IF to_regclass('cron.job') IS NOT NULL THEN
        PERFORM cron.unschedule(jobid)
        FROM cron.job
        WHERE jobname = 'expire-customer-access';
      END IF;
      PERFORM cron.schedule(
        'expire-customer-access',
        '* * * * *',
        'SELECT public.expire_customer_access()'
      );
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'pg_cron is unavailable; call /api/cron/customer-expiry from an external scheduler every minute';
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'pg_cron schedule permission is unavailable';
    END;
  ELSE
    RAISE NOTICE 'pg_cron is unavailable; call /api/cron/customer-expiry from an external scheduler every minute';
  END IF;
END;
$$;
