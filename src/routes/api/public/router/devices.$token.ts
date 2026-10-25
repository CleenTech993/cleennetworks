import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseDeviceReport, planReading } from "@/lib/inventory-monitor";

// Up/down report for inventory devices, pushed every minute by the router that monitors them
// (see buildDeviceMonitorLines). Authenticated by the router's provision token like the heartbeat.
//   /api/public/router/devices/<token>?r=<device-uuid>~1,<device-uuid>~0
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

        const readings = parseDeviceReport(new URL(request.url).searchParams.get("r"));
        if (readings.length === 0) return new Response("ok", { headers: { "content-type": "text/plain" } });

        // Only devices this router is configured to monitor, in this router's tenant.
        const { data: devices } = await supabaseAdmin
          .from("inventory_devices")
          .select("id,online")
          .eq("tenant_id", router.tenant_id)
          .eq("monitor_router_id", router.id)
          .eq("monitor_enabled", true)
          .in("id", readings.map((r) => r.id));

        const now = new Date().toISOString();
        const events: { tenant_id: string; device_id: string; event: "up" | "down"; at: string }[] = [];
        await Promise.all(
          (devices ?? []).map(async (d) => {
            const reading = readings.find((r) => r.id === d.id);
            if (!reading) return;
            const plan = planReading(d.online, reading.up, now);
            await supabaseAdmin.from("inventory_devices").update(plan.patch).eq("id", d.id);
            if (plan.event) events.push({ tenant_id: router.tenant_id, device_id: d.id, event: plan.event, at: now });
          }),
        );
        if (events.length) await supabaseAdmin.from("inventory_device_events").insert(events);

        return new Response("ok", { headers: { "content-type": "text/plain" } });
      },
    },
  },
});
