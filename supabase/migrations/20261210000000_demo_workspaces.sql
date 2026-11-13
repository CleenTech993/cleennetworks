ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.prevent_tenant_demo_flag_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND NEW.is_demo IS DISTINCT FROM OLD.is_demo THEN
    RAISE EXCEPTION 'Only the demo setup flow can change the demo workspace flag'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_tenant_demo_flag_changes() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS prevent_tenant_demo_flag_changes ON public.tenants;
CREATE TRIGGER prevent_tenant_demo_flag_changes
  BEFORE UPDATE OF is_demo ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_demo_flag_changes();

CREATE OR REPLACE FUNCTION public.seed_demo_workspace()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_is_demo boolean;
  v_router_cbd uuid := gen_random_uuid();
  v_router_estates uuid := gen_random_uuid();
  v_hotspot_hour uuid := gen_random_uuid();
  v_hotspot_day uuid := gen_random_uuid();
  v_pppoe_home uuid := gen_random_uuid();
  v_pppoe_business uuid := gen_random_uuid();
  v_customer_hotspot uuid := gen_random_uuid();
  v_customer_pppoe uuid := gen_random_uuid();
  v_customer_overdue uuid := gen_random_uuid();
  v_ticket_id uuid := gen_random_uuid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before creating a demo workspace' USING ERRCODE = '42501';
  END IF;

  SELECT p.tenant_id
  INTO v_tenant_id
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF v_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND ur.tenant_id = v_tenant_id
      AND ur.role = 'tenant_admin'
  ) THEN
    RAISE EXCEPTION 'Only a tenant administrator can create a demo workspace'
      USING ERRCODE = '42501';
  END IF;

  SELECT t.is_demo
  INTO v_is_demo
  FROM public.tenants t
  WHERE t.id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_is_demo THEN
    RETURN v_tenant_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.routers WHERE tenant_id = v_tenant_id
    UNION ALL
    SELECT 1 FROM public.packages WHERE tenant_id = v_tenant_id
    UNION ALL
    SELECT 1 FROM public.customers WHERE tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Sample data can only be loaded into a new workspace'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.tenants
  SET is_demo = true
  WHERE id = v_tenant_id;

  INSERT INTO public.routers (id, tenant_id, name, model, vendor, status, last_seen_at, cpu_usage, ram_usage)
  VALUES
    (v_router_cbd, v_tenant_id, 'Demo - Nairobi CBD', 'hEX S', 'mikrotik', 'online', now(), 24, 38),
    (v_router_estates, v_tenant_id, 'Demo - Greenview Estate', 'RB4011', 'mikrotik', 'offline', now() - interval '18 minutes', 0, 0);

  INSERT INTO public.packages (
    id, tenant_id, name, description, kind, price, duration_value, duration_unit,
    data_limit_mb, unlimited, upload_kbps, download_kbps, device_limit,
    simultaneous_logins, active
  )
  VALUES
    (v_hotspot_hour, v_tenant_id, 'Demo Hotspot - 1 Hour', 'Sample prepaid hotspot pass', 'hotspot', 50, 1, 'hours', 1024, false, 2048, 5120, 1, 1, true),
    (v_hotspot_day, v_tenant_id, 'Demo Hotspot - 1 Day', 'Sample day pass with generous data', 'hotspot', 150, 1, 'days', 5120, false, 5120, 10240, 2, 2, true),
    (v_pppoe_home, v_tenant_id, 'Demo Home - 20 Mbps', 'Sample residential PPPoE plan', 'pppoe', 2500, 1, 'months', NULL, true, 10000, 20000, 1, 1, true),
    (v_pppoe_business, v_tenant_id, 'Demo Business - 50 Mbps', 'Sample business PPPoE plan', 'pppoe', 6500, 1, 'months', NULL, true, 25000, 50000, 1, 1, true);

  INSERT INTO public.customers (
    id, tenant_id, full_name, phone, email, customer_type, pppoe_username,
    pppoe_password, status, package_id, router_id, expires_at, last_seen_at,
    last_router_id, last_ip, last_mac, data_used_bytes
  )
  VALUES
    (v_customer_hotspot, v_tenant_id, 'Demo Customer - Amina', '0000000001', 'amina@example.invalid', 'hotspot', NULL, NULL, 'active', v_hotspot_day, v_router_cbd, now() + interval '12 hours', now() - interval '4 minutes', v_router_cbd, '192.0.2.41', '02:00:00:00:00:41', 734003200),
    (v_customer_pppoe, v_tenant_id, 'Demo Customer - Brian', '0000000002', 'brian@example.invalid', 'pppoe', 'demo_brian', 'sample-only-password', 'active', v_pppoe_home, v_router_cbd, now() + interval '12 days', now() - interval '2 minutes', v_router_cbd, '192.0.2.52', '02:00:00:00:00:52', 5368709120),
    (v_customer_overdue, v_tenant_id, 'Demo Customer - Wanjiku', '0000000003', 'wanjiku@example.invalid', 'pppoe', 'demo_wanjiku', 'sample-only-password', 'suspended', v_pppoe_business, v_router_estates, now() - interval '3 days', now() - interval '4 days', v_router_estates, '192.0.2.63', '02:00:00:00:00:63', 0);

  INSERT INTO public.sessions (
    tenant_id, customer_id, router_id, mac_address, ip_address,
    started_at, bytes_in, bytes_out, status
  )
  VALUES
    (v_tenant_id, v_customer_hotspot, v_router_cbd, '02:00:00:00:00:41', '192.0.2.41', now() - interval '42 minutes', 102400000, 634003200, 'active'),
    (v_tenant_id, v_customer_pppoe, v_router_cbd, '02:00:00:00:00:52', '192.0.2.52', now() - interval '3 hours', 2147483648, 3221225472, 'active'),
    (v_tenant_id, v_customer_overdue, v_router_estates, '02:00:00:00:00:63', '192.0.2.63', now() - interval '5 days', 0, 0, 'ended');

  INSERT INTO public.payments (
    tenant_id, customer_id, package_id, phone, amount, mpesa_receipt,
    provider, status, raw_callback, created_at
  )
  VALUES
    (v_tenant_id, v_customer_hotspot, v_hotspot_day, '0000000001', 150, 'DEMO-' || replace(v_tenant_id::text, '-', '') || '-001', 'daraja', 'success', '{"demo":true}'::jsonb, now() - interval '20 minutes'),
    (v_tenant_id, v_customer_pppoe, v_pppoe_home, '0000000002', 2500, 'DEMO-' || replace(v_tenant_id::text, '-', '') || '-002', 'daraja', 'success', '{"demo":true}'::jsonb, now() - interval '1 day'),
    (v_tenant_id, v_customer_overdue, v_pppoe_business, '0000000003', 6500, NULL, 'daraja', 'failed', '{"demo":true}'::jsonb, now() - interval '2 days');

  INSERT INTO public.captive_portals (tenant_id, primary_color, welcome_text, terms_text)
  VALUES (
    v_tenant_id,
    '#176b5b',
    'Welcome to the Demo Network. Choose a package to get connected.',
    'This sample portal is for demonstration only.'
  );

  INSERT INTO public.inventory_items (tenant_id, category, name, brand, model, quantity, reorder_level, unit_cost, notes)
  VALUES
    (v_tenant_id, 'router', 'Demo Router Stock', 'MikroTik', 'hEX S', 4, 2, 9500, 'Fictional demo inventory'),
    (v_tenant_id, 'ont', 'Demo Fibre ONT', 'Generic', 'GPON-ONT', 12, 5, 2800, 'Fictional demo inventory');

  INSERT INTO public.support_tickets (id, tenant_id, customer_id, subject, body, status, created_at)
  VALUES (
    v_ticket_id,
    v_tenant_id,
    v_customer_hotspot,
    'Demo: connection is slower than expected',
    'Sample support request for exploring the customer support workflow.',
    'open',
    now() - interval '1 hour'
  );

  INSERT INTO public.work_orders (tenant_id, customer_id, ticket_id, title, description, status, priority, scheduled_at)
  VALUES (
    v_tenant_id,
    v_customer_hotspot,
    v_ticket_id,
    'Demo: check access point coverage',
    'Sample field visit. No real customer or address is associated with this record.',
    'scheduled',
    'normal',
    now() + interval '1 day'
  );

  RETURN v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_demo_workspace() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_demo_workspace() TO authenticated;

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
        AND NOT t.is_demo
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
