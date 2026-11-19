import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadAlertSettings } from "@/lib/alerts.server";
import { sendSms, smsConfigured } from "@/lib/sms.server";

type Fail = { ok: false; error: string };

async function tenantAdminId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "tenant_admin")
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.tenant_id ?? null;
}

/** Whether this tenant has supplied Africa's Talking credentials. */
export const getSmsStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }): Promise<{ configured: boolean }> => {
    const tenantId = await tenantAdminId(context.userId);
    return { configured: tenantId ? await smsConfigured(tenantId) : false };
  });

/** Sends a test SMS to the tenant's alert numbers. Tenant admins only; tenant comes from their role row. */
export const sendTestAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }): Promise<{ ok: true; sentTo: number } | Fail> => {
    const tenantId = await tenantAdminId(context.userId);
    if (!tenantId) return { ok: false, error: "Only tenant admins can send a test alert." };

    const settings = await loadAlertSettings(tenantId);
    if (!settings || settings.sms_numbers.length === 0)
      return { ok: false, error: "Add at least one phone number and save first." };
    if (!(await smsConfigured(tenantId)))
      return {
        ok: false,
        error: "SMS isn't configured for this tenant. Add your Africa's Talking credentials first.",
      };

    const res = await sendSms(
      tenantId,
      settings.sms_numbers,
      "NetGrid: test alert. You will get device-offline and low-stock alerts on this number.",
    );
    return res.ok
      ? { ok: true, sentTo: settings.sms_numbers.length }
      : { ok: false, error: res.error };
  });
