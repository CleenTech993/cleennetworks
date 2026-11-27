ALTER TABLE public.voucher_inventory_settings
  ALTER COLUMN package_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS voucher_inventory_settings_router_pool_key
  ON public.voucher_inventory_settings (router_id)
  WHERE package_id IS NULL;

CREATE OR REPLACE FUNCTION public.validate_voucher_inventory_setting()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.routers router
    WHERE router.id = NEW.router_id
      AND router.tenant_id = NEW.tenant_id
      AND router.vendor = 'mikrotik'
  ) OR (
    NEW.package_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.packages package
      WHERE package.id = NEW.package_id
        AND package.tenant_id = NEW.tenant_id
        AND package.kind IN ('hotspot', 'voucher')
    )
  ) THEN
    RAISE EXCEPTION 'Router and optional hotspot package must belong to this tenant';
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO public.voucher_inventory_settings (
  tenant_id,
  router_id,
  package_id,
  enabled,
  minimum_stock,
  target_stock,
  maximum_stock,
  batch_size
)
SELECT
  tenant_id,
  router_id,
  NULL,
  bool_or(enabled),
  LEAST(500, SUM(minimum_stock))::integer,
  LEAST(500, SUM(target_stock))::integer,
  LEAST(500, SUM(maximum_stock))::integer,
  LEAST(500, MAX(batch_size))::integer
FROM public.voucher_inventory_settings
WHERE package_id IS NOT NULL
GROUP BY tenant_id, router_id
ON CONFLICT (router_id) WHERE package_id IS NULL DO NOTHING;

UPDATE public.voucher_inventory_settings
SET enabled = false,
    replenishment_lock_until = NULL
WHERE package_id IS NOT NULL;

UPDATE public.vouchers
SET package_id = NULL,
    bound_mac = NULL
WHERE payment_id IS NULL
  AND router_id IS NOT NULL
  AND sync_status IN ('pending', 'available');

CREATE OR REPLACE FUNCTION public.save_voucher_inventory_settings(
  p_tenant_id uuid,
  p_router_id uuid,
  p_package_id uuid,
  p_enabled boolean,
  p_minimum_stock integer,
  p_target_stock integer,
  p_maximum_stock integer,
  p_batch_size integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_package_id IS NOT NULL THEN
    RAISE EXCEPTION 'Pre-generated voucher stock must not be assigned to a package';
  END IF;

  IF p_minimum_stock < 0 OR p_target_stock < 1 OR p_maximum_stock < 1
    OR p_batch_size < 1 OR p_batch_size > 500
    OR p_minimum_stock > p_target_stock OR p_target_stock > p_maximum_stock
    OR p_maximum_stock > 500 THEN
    RAISE EXCEPTION 'Invalid voucher stock levels';
  END IF;

  INSERT INTO public.voucher_inventory_settings (
    tenant_id, router_id, package_id, enabled, minimum_stock,
    target_stock, maximum_stock, batch_size, updated_at
  ) VALUES (
    p_tenant_id, p_router_id, NULL, p_enabled, p_minimum_stock,
    p_target_stock, p_maximum_stock, p_batch_size, now()
  )
  ON CONFLICT (router_id) WHERE package_id IS NULL DO UPDATE SET
    enabled = EXCLUDED.enabled,
    minimum_stock = EXCLUDED.minimum_stock,
    target_stock = EXCLUDED.target_stock,
    maximum_stock = EXCLUDED.maximum_stock,
    batch_size = EXCLUDED.batch_size,
    updated_at = now()
  WHERE public.voucher_inventory_settings.tenant_id = EXCLUDED.tenant_id
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Voucher inventory setting does not belong to this tenant';
  END IF;

  IF NOT p_enabled THEN
    UPDATE public.vouchers
    SET sync_status = 'quarantined'
    WHERE tenant_id = p_tenant_id
      AND router_id = p_router_id
      AND package_id IS NULL
      AND status = 'unused'
      AND payment_id IS NULL
      AND sync_status IN ('pending', 'available');
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_voucher_inventory_settings(
  uuid, uuid, uuid, boolean, integer, integer, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_voucher_inventory_settings(
  uuid, uuid, uuid, boolean, integer, integer, integer, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.insert_presynced_vouchers(
  p_setting_id uuid,
  p_codes text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_setting public.voucher_inventory_settings%ROWTYPE;
  v_inserted integer;
BEGIN
  IF p_codes IS NULL OR cardinality(p_codes) = 0 OR cardinality(p_codes) > 500 THEN
    RAISE EXCEPTION 'Invalid voucher batch size';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_codes) AS codes(code)
    WHERE code !~ '^[A-Za-z0-9._@-]{8,64}$'
  ) OR cardinality(p_codes) <> (
    SELECT count(DISTINCT code) FROM unnest(p_codes) AS codes(code)
  ) THEN
    RAISE EXCEPTION 'Invalid or duplicate voucher code';
  END IF;

  SELECT * INTO v_setting
  FROM public.voucher_inventory_settings
  WHERE id = p_setting_id
    AND package_id IS NULL
    AND enabled
    AND replenishment_lock_until > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  INSERT INTO public.vouchers (
    tenant_id, router_id, package_id, code, status, sync_status
  )
  SELECT
    v_setting.tenant_id,
    v_setting.router_id,
    NULL,
    codes.code,
    'unused',
    'pending'
  FROM unnest(p_codes) AS codes(code);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_presynced_vouchers(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_presynced_vouchers(uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_presynced_hotspot_payment(
  p_payment_id uuid,
  p_receipt text,
  p_raw_callback jsonb,
  p_legacy_expires_at timestamptz
)
RETURNS TABLE (
  assigned_voucher_code text,
  fulfillment_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_voucher public.vouchers%ROWTYPE;
  v_code text;
  v_enabled boolean := false;
  v_fulfillment_status text := 'legacy';
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.status = 'success' THEN
    RETURN QUERY SELECT v_payment.voucher_code, v_payment.fulfillment_status;
    RETURN;
  END IF;

  IF v_payment.status <> 'processing' THEN
    RAISE EXCEPTION 'Payment is not claimed for settlement';
  END IF;

  IF v_payment.package_id IS NOT NULL
    AND v_payment.router_id IS NOT NULL
    AND v_payment.bound_mac IS NOT NULL THEN
    SELECT settings.enabled INTO v_enabled
    FROM public.voucher_inventory_settings settings
    WHERE settings.tenant_id = v_payment.tenant_id
      AND settings.router_id = v_payment.router_id
      AND settings.package_id IS NULL;

    IF COALESCE(v_enabled, false) THEN
      SELECT voucher.* INTO v_voucher
      FROM public.vouchers voucher
      WHERE voucher.tenant_id = v_payment.tenant_id
        AND voucher.router_id = v_payment.router_id
        AND voucher.package_id IS NULL
        AND voucher.status = 'unused'
        AND voucher.sync_status = 'available'
        AND voucher.payment_id IS NULL
        AND (voucher.expires_at IS NULL OR voucher.expires_at > now())
      ORDER BY voucher.created_at, voucher.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.vouchers
        SET package_id = v_payment.package_id,
            payment_id = v_payment.id,
            bound_mac = v_payment.bound_mac,
            expires_at = NULL,
            activation_started_at = NULL
        WHERE id = v_voucher.id;
        v_fulfillment_status := 'assigned';
      END IF;
    END IF;
  END IF;

  IF v_fulfillment_status <> 'assigned' THEN
    LOOP
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));
      INSERT INTO public.vouchers (
        tenant_id, router_id, package_id, code, status, sync_status,
        payment_id, bound_mac, activation_started_at, expires_at
      ) VALUES (
        v_payment.tenant_id, v_payment.router_id, v_payment.package_id, v_code, 'unused',
        'legacy', v_payment.id, v_payment.bound_mac, now(), p_legacy_expires_at
      )
      ON CONFLICT (tenant_id, code) DO NOTHING
      RETURNING * INTO v_voucher;
      EXIT WHEN FOUND;
    END LOOP;
    v_fulfillment_status := 'generated';
  END IF;

  UPDATE public.payments
  SET status = 'success',
      mpesa_receipt = p_receipt,
      raw_callback = p_raw_callback,
      voucher_code = v_voucher.code,
      fulfillment_status = v_fulfillment_status,
      fulfilled_at = now(),
      expires_at = CASE
        WHEN v_fulfillment_status = 'assigned' THEN NULL
        ELSE p_legacy_expires_at
      END
  WHERE id = v_payment.id;

  RETURN QUERY
  SELECT
    v_voucher.code,
    v_fulfillment_status;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_presynced_hotspot_payment(uuid, text, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_presynced_hotspot_payment(uuid, text, jsonb, timestamptz)
  TO service_role;
