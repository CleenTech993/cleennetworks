ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS router_id uuid REFERENCES public.routers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payments_tenant_router_idx
  ON public.payments (tenant_id, router_id, created_at DESC)
  WHERE router_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.hotspot_payment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  mac text NOT NULL CHECK (mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  connected_seconds integer NOT NULL DEFAULT 0 CHECK (connected_seconds >= 0),
  completed_seconds integer NOT NULL DEFAULT 0 CHECK (completed_seconds >= 0),
  last_router_uptime_seconds integer NOT NULL DEFAULT 0 CHECK (last_router_uptime_seconds >= 0),
  active boolean NOT NULL DEFAULT false,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, router_id, mac)
);

CREATE INDEX IF NOT EXISTS hotspot_payment_sessions_outage_idx
  ON public.hotspot_payment_sessions (tenant_id, router_id, last_active_at DESC);

CREATE TABLE IF NOT EXISTS public.hotspot_payment_session_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  mac text NOT NULL CHECK (mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  connected_seconds integer NOT NULL CHECK (connected_seconds >= 0),
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hotspot_payment_session_samples_outage_idx
  ON public.hotspot_payment_session_samples (tenant_id, router_id, payment_id, observed_at DESC);

CREATE OR REPLACE FUNCTION public.get_hotspot_outage_usage(
  p_tenant_id uuid,
  p_router_id uuid,
  p_payment_ids uuid[],
  p_outage_started_at timestamptz
)
RETURNS TABLE(
  payment_id uuid,
  has_usage boolean,
  was_active boolean,
  connected_seconds integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH latest_device_samples AS (
    SELECT DISTINCT ON (sample.payment_id, sample.mac)
      sample.payment_id,
      sample.mac,
      sample.connected_seconds,
      sample.observed_at
    FROM public.hotspot_payment_session_samples AS sample
    WHERE sample.tenant_id = p_tenant_id
      AND sample.router_id = p_router_id
      AND sample.payment_id = ANY(p_payment_ids)
      AND sample.observed_at <= p_outage_started_at
      AND sample.observed_at >= p_outage_started_at - interval '90 days'
    ORDER BY sample.payment_id, sample.mac, sample.observed_at DESC
  ),
  payment_usage AS (
    SELECT
      sample.payment_id,
      true AS has_usage,
      bool_or(sample.observed_at >= p_outage_started_at - interval '2 minutes') AS was_active,
      max(sample.connected_seconds) AS connected_seconds
    FROM latest_device_samples AS sample
    GROUP BY sample.payment_id
  )
  SELECT
    requested.payment_id,
    COALESCE(usage.has_usage, false),
    COALESCE(usage.was_active, false),
    COALESCE(usage.connected_seconds, 0)::integer
  FROM unnest(p_payment_ids) AS requested(payment_id)
  LEFT JOIN payment_usage AS usage USING (payment_id);
$$;

CREATE TABLE IF NOT EXISTS public.hotspot_recovery_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  outage_started_at timestamptz NOT NULL,
  outage_ended_at timestamptz NOT NULL,
  recovery_mode text NOT NULL CHECK (recovery_mode IN ('tracked', 'manual')),
  reason text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outage_ended_at > outage_started_at)
);

CREATE TABLE IF NOT EXISTS public.hotspot_recovery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.hotspot_recovery_batches(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  connected_seconds integer NOT NULL CHECK (connected_seconds >= 0),
  restored_seconds integer NOT NULL CHECK (restored_seconds > 0),
  estimated boolean NOT NULL DEFAULT false,
  previous_expires_at timestamptz NOT NULL,
  new_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, payment_id)
);

ALTER TABLE public.hotspot_payment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotspot_payment_session_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotspot_recovery_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotspot_recovery_items ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.hotspot_payment_sessions TO service_role;
GRANT ALL ON public.hotspot_payment_session_samples TO service_role;
GRANT ALL ON public.hotspot_recovery_batches TO service_role;
GRANT ALL ON public.hotspot_recovery_items TO service_role;

CREATE OR REPLACE FUNCTION public.apply_hotspot_outage_recovery(
  p_tenant_id uuid,
  p_router_id uuid,
  p_outage_started_at timestamptz,
  p_outage_ended_at timestamptz,
  p_recovery_mode text,
  p_reason text,
  p_created_by uuid,
  p_items jsonb
)
RETURNS TABLE(batch_id uuid, payment_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id uuid;
  v_item jsonb;
  v_payment public.payments%ROWTYPE;
  v_payment_id uuid;
  v_connected_seconds integer;
  v_restored_seconds integer;
  v_estimated boolean;
  v_new_expires_at timestamptz;
  v_count integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Invalid hotspot recovery items';
  END IF;

  IF p_outage_ended_at <= p_outage_started_at
    OR p_outage_ended_at > now()
    OR p_recovery_mode NOT IN ('tracked', 'manual')
    OR length(trim(p_reason)) < 3
    OR jsonb_array_length(p_items) < 1
    OR jsonb_array_length(p_items) > 500
  THEN
    RAISE EXCEPTION 'Invalid hotspot recovery request';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.routers
    WHERE id = p_router_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'The recovery router does not belong to this tenant';
  END IF;

  INSERT INTO public.hotspot_recovery_batches (
    tenant_id, router_id, outage_started_at, outage_ended_at,
    recovery_mode, reason, created_by
  )
  VALUES (
    p_tenant_id, p_router_id, p_outage_started_at, p_outage_ended_at,
    p_recovery_mode, trim(p_reason), p_created_by
  )
  RETURNING id INTO v_batch_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_payment_id := (v_item->>'paymentId')::uuid;
    v_connected_seconds := (v_item->>'connectedSeconds')::integer;
    v_restored_seconds := (v_item->>'restoredSeconds')::integer;
    v_estimated := COALESCE((v_item->>'estimated')::boolean, false);

    IF v_connected_seconds < 0 OR v_restored_seconds < 1 THEN
      RAISE EXCEPTION 'Invalid hotspot recovery duration';
    END IF;

    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = v_payment_id
      AND tenant_id = p_tenant_id
      AND status = 'success'
      AND provider = 'daraja'
      AND package_id IS NOT NULL
      AND expires_at IS NOT NULL
      AND (router_id IS NULL OR router_id = p_router_id)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected payment is no longer eligible';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.hotspot_recovery_items AS item
      JOIN public.hotspot_recovery_batches AS batch ON batch.id = item.batch_id
      WHERE item.payment_id = v_payment_id
        AND batch.outage_started_at <= p_outage_ended_at
        AND batch.outage_ended_at >= p_outage_started_at
    ) THEN
      RAISE EXCEPTION 'A selected payment has already been recovered for this outage';
    END IF;

    v_new_expires_at := now() + make_interval(secs => v_restored_seconds);

    UPDATE public.payments
    SET expires_at = v_new_expires_at
    WHERE id = v_payment_id AND tenant_id = p_tenant_id;

    INSERT INTO public.hotspot_recovery_items (
      batch_id, tenant_id, payment_id, connected_seconds, restored_seconds,
      estimated, previous_expires_at, new_expires_at
    )
    VALUES (
      v_batch_id, p_tenant_id, v_payment_id, v_connected_seconds, v_restored_seconds,
      v_estimated, v_payment.expires_at, v_new_expires_at
    );

    batch_id := v_batch_id;
    payment_id := v_payment_id;
    expires_at := v_new_expires_at;
    RETURN NEXT;
    v_count := v_count + 1;
  END LOOP;

  IF v_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'Not all selected payments were recovered';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_hotspot_outage_recovery(
  uuid, uuid, timestamptz, timestamptz, text, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_hotspot_outage_recovery(
  uuid, uuid, timestamptz, timestamptz, text, text, uuid, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.get_hotspot_outage_usage(uuid, uuid, uuid[], timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hotspot_outage_usage(uuid, uuid, uuid[], timestamptz)
  TO service_role;
