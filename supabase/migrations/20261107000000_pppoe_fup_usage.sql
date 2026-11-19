ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS fup_download_kbps integer NOT NULL DEFAULT 512,
  ADD COLUMN IF NOT EXISTS fup_upload_kbps integer NOT NULL DEFAULT 256;

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_fup_download_positive,
  DROP CONSTRAINT IF EXISTS packages_fup_upload_positive;
ALTER TABLE public.packages
  ADD CONSTRAINT packages_fup_download_positive CHECK (fup_download_kbps > 0),
  ADD CONSTRAINT packages_fup_upload_positive CHECK (fup_upload_kbps > 0);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS data_used_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_session_id text,
  ADD COLUMN IF NOT EXISTS usage_bytes_in bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_bytes_out bigint NOT NULL DEFAULT 0;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_data_used_bytes_nonnegative,
  DROP CONSTRAINT IF EXISTS customers_usage_bytes_in_nonnegative,
  DROP CONSTRAINT IF EXISTS customers_usage_bytes_out_nonnegative;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_data_used_bytes_nonnegative CHECK (data_used_bytes >= 0),
  ADD CONSTRAINT customers_usage_bytes_in_nonnegative CHECK (usage_bytes_in >= 0),
  ADD CONSTRAINT customers_usage_bytes_out_nonnegative CHECK (usage_bytes_out >= 0);

CREATE OR REPLACE FUNCTION public.guard_pppoe_usage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.data_used_bytes := 0;
      NEW.usage_session_id := NULL;
      NEW.usage_bytes_in := 0;
      NEW.usage_bytes_out := 0;
    ELSIF NEW.data_used_bytes IS DISTINCT FROM OLD.data_used_bytes
       OR NEW.usage_session_id IS DISTINCT FROM OLD.usage_session_id
       OR NEW.usage_bytes_in IS DISTINCT FROM OLD.usage_bytes_in
       OR NEW.usage_bytes_out IS DISTINCT FROM OLD.usage_bytes_out THEN
      RAISE EXCEPTION 'Usage is reported by the router and cannot be edited'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_pppoe_usage() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS guard_pppoe_usage ON public.customers;
CREATE TRIGGER guard_pppoe_usage
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_pppoe_usage();

CREATE OR REPLACE FUNCTION public.reset_pppoe_usage_on_renewal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.package_id IS DISTINCT FROM OLD.package_id
     OR (NEW.expires_at IS NOT NULL AND NEW.expires_at > COALESCE(OLD.expires_at, '-infinity')) THEN
    NEW.data_used_bytes := 0;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_pppoe_usage_on_renewal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS reset_pppoe_usage_on_renewal ON public.customers;
CREATE TRIGGER reset_pppoe_usage_on_renewal
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.reset_pppoe_usage_on_renewal();

CREATE OR REPLACE FUNCTION public.record_pppoe_sessions(
  p_router_id uuid,
  p_tenant_id uuid,
  p_sessions jsonb
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH incoming AS (
    SELECT
      x.username,
      x.mac,
      x.ip,
      x.session_id,
      CASE
        WHEN x.session_id ~ '^[A-Za-z0-9._:-]{1,128}$' THEN
          CASE WHEN x.bytes_in ~ '^[0-9]{1,19}$' THEN
            CASE WHEN x.bytes_in::numeric <= 9223372036854775807 THEN x.bytes_in::bigint END
          END
      END AS bytes_in,
      CASE
        WHEN x.session_id ~ '^[A-Za-z0-9._:-]{1,128}$' THEN
          CASE WHEN x.bytes_out ~ '^[0-9]{1,19}$' THEN
            CASE WHEN x.bytes_out::numeric <= 9223372036854775807 THEN x.bytes_out::bigint END
          END
      END AS bytes_out
    FROM jsonb_to_recordset(p_sessions) AS x(
      username text,
      mac text,
      ip text,
      session_id text,
      bytes_in text,
      bytes_out text
    )
    LIMIT 500
  ), updated AS (
    UPDATE public.customers c
       SET last_mac = s.mac,
           last_ip = s.ip,
           last_seen_at = now(),
           last_router_id = p_router_id,
           data_used_bytes = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.data_used_bytes
             WHEN c.usage_session_id = s.session_id THEN
               c.data_used_bytes
               + greatest(s.bytes_in - c.usage_bytes_in, 0)
               + greatest(s.bytes_out - c.usage_bytes_out, 0)
             WHEN c.usage_session_id IS NULL THEN c.data_used_bytes
             ELSE c.data_used_bytes + s.bytes_in + s.bytes_out
           END,
           usage_session_id = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.usage_session_id
             ELSE s.session_id
           END,
           usage_bytes_in = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.usage_bytes_in
             WHEN c.usage_session_id = s.session_id THEN greatest(c.usage_bytes_in, s.bytes_in)
             ELSE s.bytes_in
           END,
           usage_bytes_out = CASE
             WHEN s.bytes_in IS NULL OR s.bytes_out IS NULL THEN c.usage_bytes_out
             WHEN c.usage_session_id = s.session_id THEN greatest(c.usage_bytes_out, s.bytes_out)
             ELSE s.bytes_out
           END
      FROM incoming s
     WHERE c.tenant_id = p_tenant_id
       AND c.customer_type = 'pppoe'
       AND c.pppoe_username = s.username
       AND (c.router_id IS NULL OR c.router_id = p_router_id)
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated;
$$;
REVOKE ALL ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) TO service_role;
