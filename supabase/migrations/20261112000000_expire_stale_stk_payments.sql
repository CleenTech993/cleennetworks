CREATE OR REPLACE FUNCTION public.expire_stale_stk_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired integer;
BEGIN
  UPDATE public.payments
  SET status = 'failed'
  WHERE status = 'pending'
    AND created_at < now() - interval '10 minutes';

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END
$$;

REVOKE ALL ON FUNCTION public.expire_stale_stk_payments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_stk_payments() TO service_role;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron is unavailable; stale STK payments will be expired on checkout only';
    RETURN;
  END IF;

  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname = 'expire-stale-stk-payments' LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'expire-stale-stk-payments',
    '*/5 * * * *',
    'SELECT public.expire_stale_stk_payments()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule stale STK payment cleanup (%); enable pg_cron to run it every 5 minutes', SQLERRM;
END
$$;