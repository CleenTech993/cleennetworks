-- PPPoE usernames must be unique within a tenant (case-insensitive): the router sync emits one
-- /ppp secret per customer, and two clients sharing a username would overwrite each other.
-- NOTE: if this fails, the tenant already has duplicate PPPoE usernames; rename them first with
--   SELECT tenant_id, lower(pppoe_username), count(*) FROM public.customers
--    WHERE pppoe_username IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_pppoe_username_key
  ON public.customers (tenant_id, lower(pppoe_username))
  WHERE pppoe_username IS NOT NULL;
