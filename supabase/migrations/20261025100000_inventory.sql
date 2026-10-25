-- Inventory management: equipment catalogue + stock levels, serialized devices that can be
-- assigned to customers and monitored, and an append-only stock ledger.
--
--   inventory_items          what you stock: routers, ONTs, access points, switches, cables, other.
--                            `quantity` is the current stock level (pieces or metres). It can only
--                            change through stock_movements, so the ledger always explains the number.
--   stock_movements          append-only ledger: received, issued to a customer, returned, damaged, ...
--   inventory_devices        individual units (serial/MAC/IP). Can be assigned to a customer and, when
--                            an IP is set, monitored: a MikroTik router pings it and reports up/down.
--   inventory_device_events  up/down history written by the platform when a monitored device changes state.
--
-- Access (same conventions as the rest of the schema: aal2 required, per-role policies):
--   read   tenant_admin, technician, support_staff
--   write  tenant_admin, technician       (stock_movements: insert only, never edited or deleted)
--   super_admin can do everything. device events are written by the server only.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.inventory_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category      text NOT NULL CHECK (category IN ('router','ont','access_point','switch','cable','other')),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  brand         text,
  model         text,
  unit          text NOT NULL DEFAULT 'pcs' CHECK (unit IN ('pcs','m')),
  quantity      numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level numeric NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  unit_cost     numeric CHECK (unit_cost IS NULL OR unit_cost >= 0),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_items_tenant_idx ON public.inventory_items (tenant_id, category);

CREATE TABLE public.inventory_devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id            uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  category           text NOT NULL CHECK (category IN ('router','ont','access_point','switch','other')),
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  brand              text,
  model              text,
  serial_number      text,
  mac_address        text CHECK (mac_address IS NULL OR mac_address ~* '^([0-9a-f]{2}:){5}[0-9a-f]{2}$'),
  ip_address         text CHECK (ip_address IS NULL OR ip_address ~ '^(25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(\.(25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}$'),
  status             text NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','deployed','faulty','retired')),
  customer_id        uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  location           text,
  notes              text,
  -- monitoring: a router on the same network pings ip_address and reports the result
  monitor_enabled    boolean NOT NULL DEFAULT false,
  monitor_router_id  uuid REFERENCES public.routers(id) ON DELETE SET NULL,
  online             boolean,
  loss_pct           smallint CHECK (loss_pct IS NULL OR loss_pct BETWEEN 0 AND 100),
  last_checked_at    timestamptz,
  last_seen_at       timestamptz,
  status_changed_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- equipment with a customer is out of stock; monitoring needs an address and a router to ping from
  CONSTRAINT inventory_devices_customer_not_in_stock CHECK (customer_id IS NULL OR status <> 'in_stock'),
  CONSTRAINT inventory_devices_monitor_needs_target CHECK (NOT monitor_enabled OR (ip_address IS NOT NULL AND monitor_router_id IS NOT NULL))
);
CREATE UNIQUE INDEX inventory_devices_serial_uniq ON public.inventory_devices (tenant_id, lower(serial_number)) WHERE serial_number IS NOT NULL AND btrim(serial_number) <> '';
CREATE INDEX inventory_devices_tenant_idx   ON public.inventory_devices (tenant_id, category);
CREATE INDEX inventory_devices_customer_idx ON public.inventory_devices (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX inventory_devices_monitor_idx  ON public.inventory_devices (monitor_router_id) WHERE monitor_enabled;

CREATE TABLE public.stock_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  change      numeric NOT NULL CHECK (change <> 0),
  reason      text NOT NULL CHECK (reason IN ('received','issued','returned','damaged','adjustment')),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  note        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_item_idx   ON public.stock_movements (item_id, created_at DESC);
CREATE INDEX stock_movements_tenant_idx ON public.stock_movements (tenant_id, created_at DESC);

CREATE TABLE public.inventory_device_events (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.inventory_devices(id) ON DELETE CASCADE,
  event     text NOT NULL CHECK (event IN ('up','down')),
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_device_events_idx ON public.inventory_device_events (device_id, at DESC);

-- ---------------------------------------------------------------------------------------------
-- Integrity triggers. RLS only checks the row's own tenant_id, so references to other tables
-- (item, customer, router, device) are verified here: nobody can point their row at another
-- tenant's data, and tenant_id can never be changed.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_items_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity <> 0 THEN
      RAISE EXCEPTION 'Add opening stock with a stock movement' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'tenant_id cannot be changed' USING ERRCODE = '42501';
    END IF;
    IF NEW.quantity IS DISTINCT FROM OLD.quantity AND COALESCE(current_setting('app.stock_move', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Stock levels change only through stock movements' USING ERRCODE = '42501';
    END IF;
    IF NEW.unit IS DISTINCT FROM OLD.unit AND OLD.quantity <> 0 THEN
      RAISE EXCEPTION 'Cannot change the unit of an item that has stock' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_items_guard BEFORE INSERT OR UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.inventory_items_guard();

CREATE OR REPLACE FUNCTION public.inventory_devices_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inventory_items WHERE id = NEW.item_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Unknown item' USING ERRCODE = '42501';
  END IF;
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Unknown customer' USING ERRCODE = '42501';
  END IF;
  IF NEW.monitor_router_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.routers WHERE id = NEW.monitor_router_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Unknown router' USING ERRCODE = '42501';
  END IF;
  -- Changing what is monitored invalidates the old reading.
  IF TG_OP = 'UPDATE' AND (NEW.ip_address IS DISTINCT FROM OLD.ip_address OR NEW.monitor_router_id IS DISTINCT FROM OLD.monitor_router_id OR NEW.monitor_enabled IS DISTINCT FROM OLD.monitor_enabled) THEN
    NEW.online := NULL; NEW.loss_pct := NULL; NEW.last_checked_at := NULL; NEW.last_seen_at := NULL; NEW.status_changed_at := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_devices_guard BEFORE INSERT OR UPDATE ON public.inventory_devices
  FOR EACH ROW EXECUTE FUNCTION public.inventory_devices_guard();

-- Applies a movement to the stock level atomically (row is locked, so two people issuing the last
-- unit at once cannot both succeed) and refuses to go below zero.
CREATE OR REPLACE FUNCTION public.stock_movements_apply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_new numeric;
BEGIN
  SELECT * INTO v_item FROM public.inventory_items
   WHERE id = NEW.item_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown item' USING ERRCODE = '42501';
  END IF;
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Unknown customer' USING ERRCODE = '42501';
  END IF;
  IF v_item.unit = 'pcs' AND NEW.change <> trunc(NEW.change) THEN
    RAISE EXCEPTION 'Pieces must be whole numbers' USING ERRCODE = '23514';
  END IF;
  -- sign must match the reason, so the history reads correctly
  IF (NEW.reason IN ('received','returned') AND NEW.change < 0)
     OR (NEW.reason IN ('issued','damaged') AND NEW.change > 0) THEN
    RAISE EXCEPTION 'Quantity direction does not match the reason' USING ERRCODE = '23514';
  END IF;
  v_new := v_item.quantity + NEW.change;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'Not enough stock: % in stock, % requested', v_item.quantity, abs(NEW.change) USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.stock_move', 'on', true);
  UPDATE public.inventory_items SET quantity = v_new WHERE id = v_item.id;
  PERFORM set_config('app.stock_move', 'off', true);

  NEW.created_by := auth.uid();
  RETURN NEW;
END $$;
CREATE TRIGGER stock_movements_apply BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.stock_movements_apply();

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_items','inventory_devices','stock_movements','inventory_device_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "%1$s require aal2" ON public.%1$I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (public.is_aal2()) WITH CHECK (public.is_aal2())', t);
    EXECUTE format(
      'CREATE POLICY "%1$s select by role" ON public.%1$I FOR SELECT TO authenticated USING ('
      'public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''tenant_admin'',''technician'',''support_staff'']::public.app_role[]))', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['inventory_items','inventory_devices'] LOOP
    EXECUTE format(
      'CREATE POLICY "%1$s insert by role" ON public.%1$I FOR INSERT TO authenticated WITH CHECK ('
      'public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''tenant_admin'',''technician'']::public.app_role[]))', t);
    EXECUTE format(
      'CREATE POLICY "%1$s update by role" ON public.%1$I FOR UPDATE TO authenticated USING ('
      'public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''tenant_admin'',''technician'']::public.app_role[])) WITH CHECK ('
      'public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''tenant_admin'',''technician'']::public.app_role[]))', t);
    EXECUTE format(
      'CREATE POLICY "%1$s delete by role" ON public.%1$I FOR DELETE TO authenticated USING ('
      'public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY[''tenant_admin'',''technician'']::public.app_role[]))', t);
  END LOOP;
END $$;

-- The ledger is append-only: insert, but never update or delete.
CREATE POLICY "stock_movements insert by role" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['tenant_admin','technician']::public.app_role[]));

-- Device events and device monitoring readings are written by the platform (service role).
REVOKE INSERT, UPDATE, DELETE ON public.inventory_device_events FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.stock_movements FROM authenticated, anon;
REVOKE ALL ON public.inventory_items, public.inventory_devices, public.stock_movements, public.inventory_device_events FROM anon;

-- Live monitoring readings (online, loss_pct, last_*_at, status_changed_at) are written only by the
-- platform's router-report endpoint. Browsers may set everything else.
REVOKE INSERT, UPDATE ON public.inventory_devices FROM authenticated;
GRANT INSERT (id, tenant_id, item_id, category, name, brand, model, serial_number, mac_address, ip_address,
              status, customer_id, location, notes, monitor_enabled, monitor_router_id)
  ON public.inventory_devices TO authenticated;
GRANT UPDATE (item_id, category, name, brand, model, serial_number, mac_address, ip_address,
              status, customer_id, location, notes, monitor_enabled, monitor_router_id)
  ON public.inventory_devices TO authenticated;
