import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { authenticateRouter } from "@/lib/router-auth.server";
import { parseRouterOsDuration } from "@/lib/router-health";
import { tooManyRequests } from "@/lib/rate-limit.server";

// Heartbeat from MikroTik routers. Optional query params push live metrics.
// Example:
//   /api/public/router/heartbeat/<token>?cpu=12&mem-free=512&mem-total=1024&uptime=86400
//     &temp=42&voltage=24.1&version=7.14&board=hAP-ac2&arch=arm&wan-ip=1.2.3.4
export const Route = createFileRoute("/api/public/router/heartbeat/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const url = new URL(request.url);
        const q = url.searchParams;
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

        const num = (k: string) => {
          const v = q.get(k);
          if (v == null || v === "") return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        const str = (k: string) => {
          const v = q.get(k);
          return v && v.length <= 200 ? v : null;
        };

        const patch: TablesUpdate<"routers"> = {
          status: "online",
          last_seen_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
          public_ip: ip,
        };

        const cpu = num("cpu");
        if (cpu != null) patch.cpu_load = Math.max(0, Math.min(100, Math.round(cpu)));
        const memFree = num("mem-free");
        if (memFree != null) patch.free_memory_mb = Math.round(memFree);
        const memTotal = num("mem-total");
        if (memTotal != null) patch.total_memory_mb = Math.round(memTotal);
        const hddFree = num("hdd-free");
        if (hddFree != null) patch.hdd_free_mb = Math.round(hddFree);
        const uptime = parseRouterOsDuration(q.get("uptime"));
        if (uptime != null) patch.uptime_seconds = uptime;
        const temp = num("temp");
        if (temp != null) patch.temperature = temp;
        const voltage = num("voltage");
        if (voltage != null) patch.voltage = voltage;
        const ramPct = (() => {
          if (memTotal && memFree != null && memTotal > 0) {
            return Math.round(((memTotal - memFree) / memTotal) * 100);
          }
          return null;
        })();
        if (ramPct != null) patch.ram_usage = ramPct;
        if (cpu != null) patch.cpu_usage = Math.round(cpu);

        const version = str("version");
        if (version) patch.routeros_version = version;
        const board = str("board");
        if (board) patch.board_name = board;
        const arch = str("arch");
        if (arch) patch.architecture = arch;
        const wanIp = str("wan-ip");
        if (wanIp) patch.wan_ip = wanIp;
        const lanIp = str("lan-ip");
        if (lanIp) patch.lan_ip = lanIp;
        const model = str("model");
        if (model) patch.model = model;

        const auth = await authenticateRouter(request, params.token);
        if (!auth.ok)
          return auth.blocked ? tooManyRequests() : new Response("unknown", { status: 404 });
        const prev = auth.router;

        await supabaseAdmin.from("routers").update(patch).eq("id", prev.id);

        const nowIso = new Date().toISOString();
        const lastPrev = prev.last_heartbeat_at ?? prev.last_seen_at;
        // If the liveness sweeper already opened an outage for this router, close it now.
        const { data: closed } = await supabaseAdmin
          .from("router_uptime_events")
          .update({ ended_at: nowIso })
          .eq("router_id", prev.id)
          .eq("kind", "down")
          .is("ended_at", null)
          .select("id");
        // Otherwise, a gap > 3 min since the last heartbeat => record a closed downtime event
        if (
          !closed?.length &&
          lastPrev &&
          Date.now() - new Date(lastPrev).getTime() > 3 * 60 * 1000
        ) {
          await supabaseAdmin.from("router_uptime_events").insert({
            router_id: prev.id,
            tenant_id: prev.tenant_id,
            kind: "down",
            started_at: lastPrev,
            ended_at: nowIso,
          });
        }

        await supabaseAdmin.from("router_metrics").insert({
          router_id: prev.id,
          tenant_id: prev.tenant_id,
          ts: nowIso,
          cpu_pct: patch.cpu_load ?? null,
          mem_pct: ramPct,
          rx_bps: num("rx-bps"),
          tx_bps: num("tx-bps"),
          wan_latency_ms: num("latency"),
          wan_loss_pct: num("loss"),
          wan_jitter_ms: num("jitter"),
          dns_ok: q.get("dns") === "1" ? true : q.get("dns") === "0" ? false : null,
          temp,
        });

        return new Response("ok", { headers: { "content-type": "text/plain" } });
      },
    },
  },
});
