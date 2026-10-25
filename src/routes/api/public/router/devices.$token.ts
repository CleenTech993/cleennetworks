import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dispatchPendingAlerts, loadAlertSettings } from "@/lib/alerts.server";
import { DEFAULT_DOWN_AFTER_MINUTES, parseDeviceReport, planAlert, planReading } from "@/lib/inventory-monitor";

// Up/down report for inventory devices, pushed every minute by the router that monitors them
// (see buildDeviceMonitorLines). Authenticated by the router's provision token like the heartbeat.
//   /api/public/router/devices/<token>?r=<device-uuid>~1~<rtt ms>,<device-uuid>~0
export const Route = createFileRoute("/api/public/router/devices/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { data: router } = await supabaseAdmin
          .from("routers")
          .select("id,tenant_id")
          .eq("provision_token", params.token)
          .maybeSingle();
        if (!router) return new Response("unknown", { status: 404 });

        const ok = () => new Response("ok", { headers: { "content-type": "text/plain" } });
        const readings = parseDeviceReport(new URL(request.url).searchParams.get("r"));
        if (readings.length === 0) return ok();

        // Only devices this router is configured to monitor, in this router's tenant.
        const { data: devices } = await supabaseAdmin
          .from("inventory_devices")
          .select("id,name,ip_address,online,status_changed_at,alerted_at")
          .eq("tenant_id", router.tenant_id)
          .eq("monitor_router_id", router.id)
          .eq("monitor_enabled", true)
          .in("id", readings.map((r) => r.id));
        if (!devices?.length) return ok();

        const settings = await loadAlertSettings(router.tenant_id);
        const downAfterMin = settings?.down_after_minutes ?? DEFAULT_DOWN_AFTER_MINUTES;

        const nowMs = Date.now();
        const now = new Date(nowMs).toISOString();
        const events: { tenant_id: string; device_id: string; event: "up" | "down"; at: string }[] = [];
        const alerts: { tenant_id: string; kind: "device_down" | "device_up"; device_id: string; message: string }[] = [];

        await Promise.all(
          devices.map(async (d) => {
            const reading = readings.find((r) => r.id === d.id);
            if (!reading) return;
            const plan = planReading(d.online, reading.up, now, reading.latencyMs);
            const alert = planAlert({
              prevOnline: d.online, statusChangedAt: d.status_changed_at, alertedAt: d.alerted_at,
              up: reading.up, nowMs, downAfterMin,
            });
            const patch = {
              ...plan.patch,
              ...(alert.alertedAtPatch === "now" ? { alerted_at: now } : alert.alertedAtPatch === "clear" ? { alerted_at: null } : {}),
            };
            await supabaseAdmin.from("inventory_devices").update(patch).eq("id", d.id);

            if (plan.event) events.push({ tenant_id: router.tenant_id, device_id: d.id, event: plan.event, at: now });
            if (alert.alert) {
              const label = d.ip_address ? `${d.name} (${d.ip_address})` : d.name;
              const mins = d.status_changed_at ? Math.max(1, Math.round((nowMs - new Date(d.status_changed_at).getTime()) / 60_000)) : downAfterMin;
              alerts.push({
                tenant_id: router.tenant_id,
                kind: alert.alert === "down" ? "device_down" : "device_up",
                device_id: d.id,
                message: alert.alert === "down" ? `${label} has been offline for ${mins} min` : `${label} is back online`,
              });
            }
          }),
        );
        if (events.length) await supabaseAdmin.from("inventory_device_events").insert(events);
        if (alerts.length) await supabaseAdmin.from("inventory_alerts").insert(alerts);

        // Send any SMS now waiting (this device's alerts, plus low-stock alerts raised by the database).
        try { await dispatchPendingAlerts(router.tenant_id); } catch { /* never fail the router's report */ }
        return ok();
      },
    },
  },
});
