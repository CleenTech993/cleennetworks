ALTER TABLE public.router_devices
  ADD COLUMN IF NOT EXISTS traffic_bytes_in bigint,
  ADD COLUMN IF NOT EXISTS traffic_bytes_out bigint,
  ADD COLUMN IF NOT EXISTS download_bps bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_bps bigint NOT NULL DEFAULT 0;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS download_bps bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_bps bigint NOT NULL DEFAULT 0;

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
      NEW.download_bps := 0;
      NEW.upload_bps := 0;
    ELSIF NEW.data_used_bytes IS DISTINCT FROM OLD.data_used_bytes
       OR NEW.usage_session_id IS DISTINCT FROM OLD.usage_session_id
       OR NEW.usage_bytes_in IS DISTINCT FROM OLD.usage_bytes_in
       OR NEW.usage_bytes_out IS DISTINCT FROM OLD.usage_bytes_out
       OR NEW.download_bps IS DISTINCT FROM OLD.download_bps
       OR NEW.upload_bps IS DISTINCT FROM OLD.upload_bps THEN
      RAISE EXCEPTION 'Usage and bandwidth are reported by the router and cannot be edited'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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
           END,
           download_bps = CASE
             WHEN s.bytes_out IS NULL OR c.usage_session_id IS DISTINCT FROM s.session_id
               OR c.last_seen_at IS NULL OR now() - c.last_seen_at > interval '3 minutes' THEN 0
             ELSE LEAST(
               floor(greatest(s.bytes_out - c.usage_bytes_out, 0)::numeric * 1000
                 / greatest(extract(epoch FROM (now() - c.last_seen_at)) * 1000, 1000)),
               9223372036854775807
             )::bigint
           END,
           upload_bps = CASE
             WHEN s.bytes_in IS NULL OR c.usage_session_id IS DISTINCT FROM s.session_id
               OR c.last_seen_at IS NULL OR now() - c.last_seen_at > interval '3 minutes' THEN 0
             ELSE LEAST(
               floor(greatest(s.bytes_in - c.usage_bytes_in, 0)::numeric * 1000
                 / greatest(extract(epoch FROM (now() - c.last_seen_at)) * 1000, 1000)),
               9223372036854775807
             )::bigint
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

REVOKE ALL ON FUNCTION public.guard_pppoe_usage() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pppoe_sessions(uuid, uuid, jsonb) TO service_role;
