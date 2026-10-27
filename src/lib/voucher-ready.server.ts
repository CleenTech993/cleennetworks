// Server-only: has the customer's router received this voucher yet? (See voucher-login.ts.)
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { voucherReachedRouter } from "./voucher-login";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Never blocks a customer on information we do not have: with no usable router id, an unknown router,
 * or a database that has not got the last_sync_at column yet, the answer is "ready" and the login is
 * simply attempted (its own error message then explains any problem).
 */
export async function routerHasVoucher(
  tenantId: string,
  routerId: string | null | undefined,
  voucherCreatedAt: string | null | undefined,
): Promise<boolean> {
  if (!routerId || !UUID.test(routerId)) return true;
  const { data, error } = await supabaseAdmin
    .from("routers")
    .select("last_sync_at")
    .eq("id", routerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return true;
  return voucherReachedRouter(data.last_sync_at, voucherCreatedAt);
}
