import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { dispatchPendingAlerts } from "@/lib/alerts.server";
import { authenticateRouter, isMissingSchema } from "@/lib/router-auth.server";
import { computeConnectedClientsCount, wouldCreateChainCycle } from "@/lib/router-chain";
import { parseRouterOsDuration } from "@/lib/router-health";
import { MIKROTIK_AGENT_CAPABILITIES } from "@/lib/device-management";
import { tooManyRequests } from "@/lib/rate-limit.server";
import { normalizeMac } from "@/lib/tv";

// Heartbeat from MikroTik routers. Optional query params push live metrics.
// Example:
//   /api/public/router/heartbeat/<token>?cpu=12&mem-free=512&mem-total=1024&uptime=86400
//     &temp=42&voltage=24.1&version=7.14&board=hAP-ac2&arch=arm&wan-ip=1.2.3.4
export const Route = createFileRoute("/api/public/router/heartbeat/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => handleHeartbeat(request, params.token),
      POST: async ({ params, request }) => handleHeartbeat(request, params.token),
    },
  },
});

async function handleHeartbeat(request: Request, token: string) {
  const url = new URL(request.url);
  const bodyText = request.method === "POST" ? await request.text() : "";
  const q =
    request.method === "POST" && bodyText ? new URLSearchParams(bodyText) : url.searchParams;
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
    vendor: "mikrotik",
    management_method: "routeros_agent",
    management_status: "online",
    capabilities: [...MIKROTIK_AGENT_CAPABILITIES],
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
  if (version) {
    patch.routeros_version = version;
    patch.firmware_version = version;
  }
  const board = str("board");
  if (board) {
    patch.board_name = board;
    patch.device_family = board;
  }
  const arch = str("arch");
  if (arch) patch.architecture = arch;
  const wanIp = str("wan-ip");
  if (wanIp) patch.wan_ip = wanIp.split("/")[0].trim();
  else if (ip) patch.wan_ip = ip;
  const lanIp = str("lan-ip");
  if (lanIp) patch.lan_ip = lanIp;
  const model = str("model");
  if (model) patch.model = model;
  const macRaw = str("mac");
  const mac = macRaw ? normalizeMac(macRaw) : null;
  if (mac) patch.mac_address = mac;
  const uplinkMacRaw = str("uplink-mac");
  const uplinkMac = uplinkMacRaw ? normalizeMac(uplinkMacRaw) : null;

  const hotspotClients = num("hotspot-clients");
  const pppoeClients = num("pppoe-clients");
  const wirelessClients = num("wireless-clients");
  const hasClientCounts = hotspotClients != null || pppoeClients != null || wirelessClients != null;

  const auth = await authenticateRouter(request, token);
  if (!auth.ok) return auth.blocked ? tooManyRequests() : new Response("unknown", { status: 404 });
  const prev = auth.router;

  const nowIso = new Date().toISOString();

  // Read existing chain/client metadata (optional — falls back cleanly if migration is not yet applied).
  const { data: currentRouter, error: currentRouterError } = await supabaseAdmin
    .from("routers")
    .select(
      "id,status,node_role,parent_router_id,mac_address,hotspot_clients_count,pppoe_clients_count,wireless_clients_count",
    )
    .eq("id", prev.id)
    .maybeSingle();

  const chainSchemaReady = !currentRouterError || !isMissingSchema(currentRouterError.message);

  if (chainSchemaReady && hasClientCounts) {
    const hs =
      hotspotClients != null
        ? Math.max(0, Math.round(hotspotClients))
        : (currentRouter?.hotspot_clients_count ?? 0);
    const pp =
      pppoeClients != null
        ? Math.max(0, Math.round(pppoeClients))
        : (currentRouter?.pppoe_clients_count ?? 0);
    const wl =
      wirelessClients != null
        ? Math.max(0, Math.round(wirelessClients))
        : (currentRouter?.wireless_clients_count ?? 0);
    patch.hotspot_clients_count = hs;
    patch.pppoe_clients_count = pp;
    patch.wireless_clients_count = wl;
    patch.connected_clients_count = computeConnectedClientsCount({
      nodeRole: currentRouter?.node_role,
      hotspotClients: hs,
      pppoeClients: pp,
      wirelessClients: wl,
    });
    patch.clients_updated_at = nowIso;
  }

  // If the router reported its upstream gateway MAC, automatically link it to the matching parent router on the chain.
  if (chainSchemaReady && uplinkMac && uplinkMac !== mac && !currentRouter?.parent_router_id) {
    const { data: tenantRouters } = await supabaseAdmin
      .from("routers")
      .select("id,mac_address,parent_router_id")
      .eq("tenant_id", prev.tenant_id);
    const parent = (tenantRouters ?? []).find(
      (r) => r.id !== prev.id && r.mac_address && normalizeMac(r.mac_address) === uplinkMac,
    );
    if (parent && !wouldCreateChainCycle(tenantRouters ?? [], prev.id, parent.id)) {
      patch.parent_router_id = parent.id;
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from("routers")
    .update(patch)
    .eq("id", prev.id);
  if (updateError && isMissingSchema(updateError.message)) {
    const fallbackPatch = { ...patch };
    delete fallbackPatch.hotspot_clients_count;
    delete fallbackPatch.pppoe_clients_count;
    delete fallbackPatch.wireless_clients_count;
    delete fallbackPatch.connected_clients_count;
    delete fallbackPatch.clients_updated_at;
    delete fallbackPatch.parent_router_id;
    await supabaseAdmin.from("routers").update(fallbackPatch).eq("id", prev.id);
  }

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
  if (!closed?.length && lastPrev && Date.now() - new Date(lastPrev).getTime() > 3 * 60 * 1000) {
    await supabaseAdmin.from("router_uptime_events").insert({
      router_id: prev.id,
      tenant_id: prev.tenant_id,
      kind: "down",
      started_at: lastPrev,
      ended_at: nowIso,
    });
  }

  if (chainSchemaReady && ((closed?.length ?? 0) > 0 || currentRouter?.status === "offline")) {
    const roleLabel = currentRouter?.node_role === "access_point" ? "Access point" : "Router";
    const resolvedMac = mac ?? currentRouter?.mac_address;
    await supabaseAdmin.from("inventory_alerts").insert({
      tenant_id: prev.tenant_id,
      kind: "router_up",
      router_id: prev.id,
      message: `${roleLabel} ${prev.name}${resolvedMac ? ` (${resolvedMac})` : ""} is back online`,
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

  try {
    await dispatchPendingAlerts(prev.tenant_id);
  } catch {
    /* never fail the router's heartbeat */
  }

  return new Response("ok", { headers: { "content-type": "text/plain" } });
}
