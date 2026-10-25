import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms, smsConfigured } from "@/lib/sms.server";

/** Most SMS a tenant can trigger in 24 hours; protects the platform's SMS balance from a flapping device. */
export const DAILY_SMS_CAP = 50;
const BATCH = 10;

type Settings = { sms_numbers: string[]; notify_device_down: boolean; notify_low_stock: boolean; down_after_minutes: number };

export async function loadAlertSettings(tenantId: string): Promise<Settings | null> {
  const { data } = await supabaseAdmin
    .from("alert_settings")
    .select("sms_numbers,notify_device_down,notify_low_stock,down_after_minutes")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

/**
 * Sends the SMS for alerts waiting in the outbox. Called from routes that routers hit every
 * minute or two, so alerts go out within about a minute or two of being raised. Each alert is
 * claimed first (pending -> sending) so overlapping requests never text twice. In-app alert
 * history is always kept; the SMS is skipped when it isn't wanted or can't be sent.
 */
export async function dispatchPendingAlerts(tenantId: string): Promise<void> {
  const { data: pending } = await supabaseAdmin
    .from("inventory_alerts")
    .select("id,kind,message")
    .eq("tenant_id", tenantId)
    .eq("sms_status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (!pending?.length) return;

  const settings = await loadAlertSettings(tenantId);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: sentToday } = await supabaseAdmin
    .from("inventory_alerts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("sms_status", "sent")
    .gte("sms_sent_at", since);
  let budget = Math.max(0, DAILY_SMS_CAP - (sentToday ?? 0));

  for (const alert of pending) {
    const { data: claimed } = await supabaseAdmin
      .from("inventory_alerts")
      .update({ sms_status: "sending" })
      .eq("id", alert.id)
      .eq("sms_status", "pending")
      .select("id");
    if (!claimed?.length) continue; // another request took it

    const wanted = alert.kind === "low_stock" ? settings?.notify_low_stock : settings?.notify_device_down;
    const numbers = settings?.sms_numbers ?? [];
    let patch: { sms_status: "sent" | "failed" | "skipped"; sms_sent_at?: string; sms_error: string | null };

    if (!settings || !wanted || numbers.length === 0) {
      patch = { sms_status: "skipped", sms_error: numbers.length === 0 ? "No SMS numbers set up" : "Turned off in alert settings" };
    } else if (!smsConfigured()) {
      patch = { sms_status: "skipped", sms_error: "SMS is not configured on the platform" };
    } else if (budget <= 0) {
      patch = { sms_status: "skipped", sms_error: `Daily SMS limit (${DAILY_SMS_CAP}) reached` };
    } else {
      const res = await sendSms(numbers, `NetGrid: ${alert.message}`);
      if (res.ok) {
        budget--;
        patch = { sms_status: "sent", sms_sent_at: new Date().toISOString(), sms_error: null };
      } else {
        patch = { sms_status: "failed", sms_error: res.error };
      }
    }
    await supabaseAdmin.from("inventory_alerts").update(patch).eq("id", alert.id);
  }
}
