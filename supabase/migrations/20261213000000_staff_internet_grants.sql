CREATE TABLE IF NOT EXISTS public.staff_internet_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  staff_name text NOT NULL,
  staff_phone text,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  access_type text NOT NULL CHECK (access_type IN ('hotspot', 'pppoe')),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  package_name text NOT NULL,
  retail_value numeric(10, 2) NOT NULL DEFAULT 0 CHECK (retail_value >= 0),
  voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  voucher_code text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  pppoe_username text,
  note text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (access_type = 'hotspot' AND customer_id IS NULL)
    OR (access_type = 'pppoe' AND voucher_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS staff_internet_grants_tenant_created_idx
  ON public.staff_internet_grants (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_internet_grants_staff_access_idx
  ON public.staff_internet_grants (tenant_id, staff_user_id, access_type, created_at DESC);

ALTER TABLE public.staff_internet_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff internet grants tenant read" ON public.staff_internet_grants;
CREATE POLICY "staff internet grants tenant read" ON public.staff_internet_grants
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_tenant_role(
      auth.uid(), tenant_id, ARRAY['tenant_admin', 'billing_agent']::public.app_role[]
    )
  );
REVOKE ALL ON public.staff_internet_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_internet_grants TO authenticated;
GRANT ALL ON public.staff_internet_grants TO service_role;

DROP FUNCTION IF EXISTS public.grant_staff_internet(
  uuid, uuid, text, uuid, uuid, uuid, text, text, text
);

CREATE OR REPLACE FUNCTION public.grant_staff_internet(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_staff_user_id uuid,
  p_access_type text,
  p_hotspot_package_id uuid DEFAULT NULL,
  p_pppoe_package_id uuid DEFAULT NULL,
  p_router_id uuid DEFAULT NULL,
  p_pppoe_username text DEFAULT NULL,
  p_pppoe_password text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_staff_name text;
  v_staff_phone text;
  v_hotspot_package public.packages%ROWTYPE;
  v_pppoe_package public.packages%ROWTYPE;
  v_expires_at timestamptz;
  v_code text;
  v_voucher_id uuid;
  v_customer_id uuid;
  v_existing_customer_id uuid;
  v_hotspot_grant_id uuid;
  v_pppoe_grant_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Staff internet must be granted through the authenticated server action'
      USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_actor_id
      AND ur.tenant_id = p_tenant_id
      AND ur.role = 'tenant_admin'
  ) THEN
    RAISE EXCEPTION 'Only tenant administrators can grant staff internet'
      USING ERRCODE = '42501';
  END IF;
  v_tenant_id := p_tenant_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_staff_user_id
      AND ur.tenant_id = v_tenant_id
      AND ur.role = 'technician'
  ) THEN
    RAISE EXCEPTION 'Select a technician on your team' USING ERRCODE = '42501';
  END IF;

  IF p_access_type IS NULL OR p_access_type NOT IN ('hotspot', 'pppoe', 'both') THEN
    RAISE EXCEPTION 'Select hotspot, PPPoE, or both access types' USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      p.email
    ),
    p.phone
  INTO v_staff_name, v_staff_phone
  FROM public.profiles p
  WHERE p.id = p_staff_user_id;
  IF v_staff_name IS NULL THEN
    RAISE EXCEPTION 'Technician profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_access_type IN ('hotspot', 'both') THEN
    SELECT * INTO v_hotspot_package
    FROM public.packages
    WHERE id = p_hotspot_package_id
      AND tenant_id = v_tenant_id
      AND active
      AND kind IN ('hotspot', 'voucher');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Select an active hotspot package for this tenant'
        USING ERRCODE = '22023';
    END IF;
    IF v_hotspot_package.duration_value IS NULL OR v_hotspot_package.duration_value <= 0
      OR v_hotspot_package.duration_unit NOT IN ('minutes', 'hours', 'days', 'weeks', 'months') THEN
      RAISE EXCEPTION 'The hotspot package must have a valid duration' USING ERRCODE = '22023';
    END IF;

    v_expires_at := now() + CASE v_hotspot_package.duration_unit
      WHEN 'minutes' THEN v_hotspot_package.duration_value * interval '1 minute'
      WHEN 'hours' THEN v_hotspot_package.duration_value * interval '1 hour'
      WHEN 'days' THEN v_hotspot_package.duration_value * interval '1 day'
      WHEN 'weeks' THEN v_hotspot_package.duration_value * interval '1 week'
      WHEN 'months' THEN v_hotspot_package.duration_value * interval '30 days'
    END;

    LOOP
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.vouchers
        WHERE tenant_id = v_tenant_id AND code = v_code
      );
    END LOOP;

    INSERT INTO public.vouchers (tenant_id, package_id, code)
    VALUES (v_tenant_id, v_hotspot_package.id, v_code)
    RETURNING id INTO v_voucher_id;

    INSERT INTO public.staff_internet_grants (
      tenant_id, staff_user_id, staff_name, staff_phone, granted_by, access_type, package_id,
      package_name, retail_value, voucher_id, voucher_code, note, expires_at
    )
    VALUES (
      v_tenant_id, p_staff_user_id, v_staff_name, v_staff_phone, p_actor_id, 'hotspot', v_hotspot_package.id,
      v_hotspot_package.name, v_hotspot_package.price, v_voucher_id, v_code,
      NULLIF(trim(p_note), ''), v_expires_at
    )
    RETURNING id INTO v_hotspot_grant_id;
  END IF;

  IF p_access_type IN ('pppoe', 'both') THEN
    SELECT * INTO v_pppoe_package
    FROM public.packages
    WHERE id = p_pppoe_package_id
      AND tenant_id = v_tenant_id
      AND active
      AND kind = 'pppoe';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Select an active PPPoE package for this tenant'
        USING ERRCODE = '22023';
    END IF;
    IF v_pppoe_package.duration_value IS NULL OR v_pppoe_package.duration_value <= 0
      OR v_pppoe_package.duration_unit NOT IN ('minutes', 'hours', 'days', 'weeks', 'months') THEN
      RAISE EXCEPTION 'The PPPoE package must have a valid duration' USING ERRCODE = '22023';
    END IF;
    IF p_router_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.routers r
      WHERE r.id = p_router_id AND r.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Select a router belonging to this tenant' USING ERRCODE = '22023';
    END IF;
    IF p_pppoe_username IS NULL
      OR p_pppoe_username !~ '^[A-Za-z0-9._@-]{3,64}$'
      OR p_pppoe_password IS NULL
      OR p_pppoe_password !~ '^[A-Za-z0-9._@-]{4,64}$' THEN
      RAISE EXCEPTION 'Enter a valid PPPoE username and password' USING ERRCODE = '22023';
    END IF;

    v_expires_at := now() + CASE v_pppoe_package.duration_unit
      WHEN 'minutes' THEN v_pppoe_package.duration_value * interval '1 minute'
      WHEN 'hours' THEN v_pppoe_package.duration_value * interval '1 hour'
      WHEN 'days' THEN v_pppoe_package.duration_value * interval '1 day'
      WHEN 'weeks' THEN v_pppoe_package.duration_value * interval '1 week'
      WHEN 'months' THEN v_pppoe_package.duration_value * interval '30 days'
    END;

    SELECT c.id INTO v_existing_customer_id
    FROM public.staff_internet_grants g
    JOIN public.customers c ON c.id = g.customer_id
    WHERE g.tenant_id = v_tenant_id
      AND g.staff_user_id = p_staff_user_id
      AND g.access_type = 'pppoe'
    ORDER BY g.created_at DESC
    LIMIT 1
    FOR UPDATE OF c;

    IF v_existing_customer_id IS NULL THEN
      INSERT INTO public.customers (
        tenant_id, full_name, phone, customer_type, status, pppoe_username,
        pppoe_password, package_id, router_id, expires_at
      )
      VALUES (
        v_tenant_id, v_staff_name, v_staff_phone, 'pppoe', 'active',
        p_pppoe_username, p_pppoe_password, v_pppoe_package.id, p_router_id, v_expires_at
      )
      RETURNING id INTO v_customer_id;
    ELSE
      v_customer_id := v_existing_customer_id;
      UPDATE public.customers
      SET full_name = v_staff_name,
          phone = v_staff_phone,
          status = 'active',
          pppoe_username = p_pppoe_username,
          pppoe_password = p_pppoe_password,
          package_id = v_pppoe_package.id,
          router_id = p_router_id,
          expires_at = greatest(COALESCE(expires_at, now()), now())
            + (v_expires_at - now())
      WHERE id = v_customer_id;
      SELECT expires_at INTO v_expires_at
      FROM public.customers WHERE id = v_customer_id;
    END IF;

    INSERT INTO public.staff_internet_grants (
      tenant_id, staff_user_id, staff_name, staff_phone, granted_by, access_type, package_id,
      package_name, retail_value, customer_id, pppoe_username, note, expires_at
    )
    VALUES (
      v_tenant_id, p_staff_user_id, v_staff_name, v_staff_phone, p_actor_id, 'pppoe', v_pppoe_package.id,
      v_pppoe_package.name, v_pppoe_package.price, v_customer_id, p_pppoe_username,
      NULLIF(trim(p_note), ''), v_expires_at
    )
    RETURNING id INTO v_pppoe_grant_id;
  END IF;

  RETURN jsonb_build_object(
    'hotspot_grant_id', v_hotspot_grant_id,
    'hotspot_code', v_code,
    'pppoe_grant_id', v_pppoe_grant_id,
    'pppoe_username', CASE WHEN p_access_type IN ('pppoe', 'both') THEN p_pppoe_username END,
    'pppoe_password', CASE WHEN p_access_type IN ('pppoe', 'both') THEN p_pppoe_password END,
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_staff_internet(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_staff_internet(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.generate_due_customer_invoices(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer record;
  v_period_end timestamptz;
  v_invoice_number text;
  v_count integer := 0;
BEGIN
  UPDATE public.customer_invoices
     SET status = 'overdue'
   WHERE status = 'pending'
     AND due_at <= p_now;

  FOR v_customer IN
    SELECT
      c.id,
      c.tenant_id,
      c.package_id,
      c.expires_at,
      pkg.name,
      pkg.price,
      pkg.duration_value,
      pkg.duration_unit
    FROM public.customers AS c
    JOIN public.packages AS pkg
      ON pkg.id = c.package_id
     AND pkg.tenant_id = c.tenant_id
     AND pkg.kind = 'pppoe'
    WHERE c.customer_type = 'pppoe'
      AND c.status = 'active'
      AND c.expires_at IS NOT NULL
      AND c.expires_at <= p_now
      AND pkg.price > 0
      AND pkg.duration_value > 0
      AND pkg.duration_unit IN ('minutes', 'hours', 'days', 'weeks', 'months')
      AND pkg.duration_value <= 2147483647
      AND NOT EXISTS (
        SELECT 1
          FROM public.payments AS payment
         WHERE payment.tenant_id = c.tenant_id
           AND payment.customer_id = c.id
           AND payment.status IN ('pending', 'processing')
      )
      AND NOT EXISTS (
        SELECT 1
          FROM public.staff_internet_grants AS staff_grant
         WHERE staff_grant.tenant_id = c.tenant_id
           AND staff_grant.customer_id = c.id
      )
    ORDER BY c.expires_at, c.id
  LOOP
    v_period_end := v_customer.expires_at + CASE v_customer.duration_unit
      WHEN 'minutes' THEN v_customer.duration_value * interval '1 minute'
      WHEN 'hours' THEN v_customer.duration_value * interval '1 hour'
      WHEN 'days' THEN v_customer.duration_value * interval '1 day'
      WHEN 'weeks' THEN v_customer.duration_value * interval '1 week'
      WHEN 'months' THEN v_customer.duration_value * interval '30 days'
    END;
    v_invoice_number := 'C-' || to_char(p_now AT TIME ZONE 'Africa/Nairobi', 'YYYYMM')
      || '-' || lpad(nextval('public.customer_invoice_number_seq')::text, 8, '0');

    INSERT INTO public.customer_invoices (
      tenant_id, customer_id, package_id, invoice_number, amount, status,
      package_name, service_period_start, service_period_end, duration_value, duration_unit,
      issued_at, due_at
    )
    VALUES (
      v_customer.tenant_id,
      v_customer.id,
      v_customer.package_id,
      v_invoice_number,
      ceil(v_customer.price),
      'pending',
      v_customer.name,
      v_customer.expires_at,
      v_period_end,
      v_customer.duration_value,
      v_customer.duration_unit,
      p_now,
      v_customer.expires_at + interval '3 days'
    )
    ON CONFLICT (customer_id, service_period_start) DO NOTHING;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_due_customer_invoices(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_due_customer_invoices(timestamptz)
  TO service_role;
