import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadAlertSettings } from "@/lib/alerts.server";
import { sendSms, smsConfigured } from "@/lib/sms.server";

type Fail = { ok: false; error: string };

/** Whether the platform can send SMS at all (credentials set). Lets the settings screen explain itself. */
export const getSmsStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async (): Promise<{ configured: boolean }> => ({ configured: smsConfigured() }));

/** Sends a test SMS to the tenant's alert numbers. Tenant admins only; tenant comes from their role row. */
export const sendTestAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }): Promise<{ ok: true; sentTo: number } | Fail> => {
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("tenant_id")
      .eq("user_id", context.userId)
      .eq("role", "tenant_admin")
      .not("tenant_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (!role?.tenant_id) return { ok: false, error: "Only tenant admins can send a test alert." };

    const settings = await loadAlertSettings(role.tenant_id);
    if (!settings || settings.sms_numbers.length === 0)
      return { ok: false, error: "Add at least one phone number and save first." };
    if (!smsConfigured())
      return {
        ok: false,
        error:
          "SMS isn't set up on the platform yet. Ask the platform owner to add the SMS credentials.",
      };

    const res = await sendSms(
      settings.sms_numbers,
      "NetGrid: test alert. You will get device-offline and low-stock alerts on this number.",
    );
    return res.ok
      ? { ok: true, sentTo: settings.sms_numbers.length }
      : { ok: false, error: res.error };
  });
