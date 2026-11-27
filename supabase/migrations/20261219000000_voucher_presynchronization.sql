ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS router_id uuid REFERENCES public.routers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS sync_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_started_at timestamptz;

ALTER TABLE public.vouchers
  DROP CONSTRAINT IF EXISTS vouchers_sync_status_check;
ALTER TABLE public.vouchers
  ADD CONSTRAINT vouchers_sync_status_check
  CHECK (sync_status IN ('legacy', 'pending', 'available', 'quarantined'));

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;

CREATE INDEX IF NOT EXISTS vouchers_presync_available_idx
  ON public.vouchers (tenant_id, router_id, package_id, created_at)
  WHERE status = 'unused'
    AND sync_status = 'available'
    AND payment_id IS NULL;

CREATE INDEX IF NOT EXISTS vouchers_presync_sync_idx
  ON public.vouchers (tenant_id, router_id, package_id, created_at)
  WHERE status = 'unused'
    AND sync_status IN ('pending', 'available');

CREATE TABLE IF NOT EXISTS public.voucher_inventory_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES public.routers(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  minimum_stock integer NOT NULL DEFAULT 20 CHECK (minimum_stock >= 0),
  target_stock integer NOT NULL DEFAULT 100 CHECK (target_stock >= 1),
  maximum_stock integer NOT NULL DEFAULT 500 CHECK (maximum_stock >= 1),
  batch_size integer NOT NULL DEFAULT 100 CHECK (batch_size BETWEEN 1 AND 500),
  replenishment_lock_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voucher_inventory_settings_stock_bounds CHECK (
    minimum_stock <= target_stock AND target_stock <= maximum_stock
  ),
  CONSTRAINT voucher_inventory_settings_router_package_key UNIQUE (router_id, package_id)
);

CREATE INDEX IF NOT EXISTS voucher_inventory_settings_enabled_idx
  ON public.voucher_inventory_settings (tenant_id, router_id, package_id)
  WHERE enabled;

CREATE OR REPLACE FUNCTION public.validate_voucher_inventory_setting()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.routers router
    JOIN public.packages package
      ON package.tenant_id = router.tenant_id
    WHERE router.id = NEW.router_id
      AND router.tenant_id = NEW.tenant_id
      AND router.vendor = 'mikrotik'
      AND package.id = NEW.package_id
      AND package.kind IN ('hotspot', 'voucher')
  ) THEN
    RAISE EXCEPTION 'Router and hotspot package must belong to this tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS voucher_inventory_settings_validate ON public.voucher_inventory_settings;
CREATE TRIGGER voucher_inventory_settings_validate
  BEFORE INSERT OR UPDATE OF tenant_id, router_id, package_id
  ON public.voucher_inventory_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_voucher_inventory_setting();

ALTER TABLE public.voucher_inventory_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voucher inventory settings read" ON public.voucher_inventory_settings;
CREATE POLICY "voucher inventory settings read" ON public.voucher_inventory_settings
  FOR SELECT TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin','billing_agent']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "voucher inventory settings insert" ON public.voucher_inventory_settings;
CREATE POLICY "voucher inventory settings insert" ON public.voucher_inventory_settings
  FOR INSERT TO authenticated WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id IN (
      SELECT public.tenants_with_role(ARRAY['tenant_admin']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "voucher inventory settings update" ON public.voucher_inventory_settings;
CREATE POLICY "voucher inventory settings update" ON public.voucher_inventory_settings
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

DROP POLICY IF EXISTS "voucher inventory settings require aal2" ON public.voucher_inventory_settings;
CREATE POLICY "voucher inventory settings require aal2" ON public.voucher_inventory_settings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_aal2())
  WITH CHECK (public.is_aal2());

GRANT SELECT, INSERT, UPDATE ON public.voucher_inventory_settings TO authenticated;
GRANT ALL ON public.voucher_inventory_settings TO service_role;

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
    p_tenant_id, p_router_id, p_package_id, p_enabled, p_minimum_stock,
    p_target_stock, p_maximum_stock, p_batch_size, now()
  )
  ON CONFLICT (router_id, package_id) DO UPDATE SET
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
      AND package_id = p_package_id
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
    v_setting.package_id,
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

  IF v_payment.package_id IS NOT NULL AND v_payment.router_id IS NOT NULL THEN
    SELECT settings.enabled INTO v_enabled
    FROM public.voucher_inventory_settings settings
    WHERE settings.tenant_id = v_payment.tenant_id
      AND settings.router_id = v_payment.router_id
      AND settings.package_id = v_payment.package_id;

    IF COALESCE(v_enabled, false) THEN
      SELECT voucher.* INTO v_voucher
      FROM public.vouchers voucher
      WHERE voucher.tenant_id = v_payment.tenant_id
        AND voucher.router_id = v_payment.router_id
        AND voucher.package_id = v_payment.package_id
        AND voucher.status = 'unused'
        AND voucher.sync_status = 'available'
        AND voucher.payment_id IS NULL
        AND (voucher.expires_at IS NULL OR voucher.expires_at > now())
      ORDER BY voucher.created_at, voucher.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.vouchers
        SET payment_id = v_payment.id,
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
        payment_id, activation_started_at, expires_at
      ) VALUES (
        v_payment.tenant_id, v_payment.router_id, v_payment.package_id, v_code, 'unused',
        'legacy', v_payment.id, now(), p_legacy_expires_at
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
