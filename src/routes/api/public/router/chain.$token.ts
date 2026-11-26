import { createFileRoute } from "@tanstack/react-router";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { dispatchPendingAlerts } from "@/lib/alerts.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { authenticateRouter, isMissingSchema } from "@/lib/router-auth.server";
import {
  buildChainNodeName,
  inferChainNodeType,
  parseChainReport,
  wouldCreateChainCycle,
} from "@/lib/router-chain";
import { normalizeMac } from "@/lib/tv";

// Neighbor / chain report pushed every minute by an upstream MikroTik router (`netgrid-chain`).
// Body: records "mac|ip|identity|platform|board|version|interface|reachable|client_count" separated by ";".
//
// Responsibilities:
//  1. Automatically detect the MAC address of downstream routers and access points on the chain
//     and add them to `routers` (within the reporting router's tenant) when not already registered.
//  2. Link existing tenant routers/APs by MAC to their upstream parent on the chain.
//  3. Update live reachability (online/offline) and client counts for chain-monitored nodes, raising
//     `router_down` / `router_up` / `chain_node_discovered` alerts when state changes.
export const Route = createFileRoute("/api/public/router/chain/$token")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const auth = await authenticateRouter(request, params.token);
        if (!auth.ok) {
          return auth.blocked ? tooManyRequests() : new Response("unknown", { status: 404 });
        }
        const upstream = auth.router;
        if (!rateLimit(`chain:${upstream.id}`, 30, 60_000)) return tooManyRequests();

        const body = (await request.text()).slice(0, 64_000);
        const neighbors = parseChainReport(body);

        const { data: tenantRouters, error: loadError } = await supabaseAdmin
          .from("routers")
          .select(
            "id,tenant_id,name,mac_address,parent_router_id,discovered_by_router_id,management_method,status,node_role,auto_chain_discovery,last_heartbeat_at,last_seen_at,wan_ip,lan_ip,board_name,firmware_version,connected_clients_count",
          )
          .eq("tenant_id", upstream.tenant_id);

        if (loadError) {
          if (isMissingSchema(loadError.message)) {
            return new Response("ok", { headers: { "content-type": "text/plain" } });
          }
          console.error("chain report: could not load tenant routers", loadError);
          return new Response("error", { status: 500 });
        }

        const allRouters = tenantRouters ?? [];
        const upstreamRow = allRouters.find((r) => r.id === upstream.id);
        const autoDiscoveryEnabled = upstreamRow?.auto_chain_discovery !== false;

        const byMac = new Map<string, (typeof allRouters)[number]>();
        for (const r of allRouters) {
          const mac = r.mac_address ? normalizeMac(r.mac_address) : null;
          if (mac) byMac.set(mac, r);
        }

        const nowIso = new Date().toISOString();
        const nowMs = Date.parse(nowIso);
        const seenNeighborRouterIds = new Set<string>();
        const alertsToInsert: {
          tenant_id: string;
          kind: "router_down" | "router_up" | "chain_node_discovered";
          router_id: string;
          message: string;
        }[] = [];

        for (const nb of neighbors) {
          const existing = byMac.get(nb.mac);

          if (existing) {
            if (existing.id === upstream.id) continue;
            seenNeighborRouterIds.add(existing.id);

            const patch: TablesUpdate<"routers"> = {};
            if (nb.iface && !existing.parent_router_id) {
              if (!wouldCreateChainCycle(allRouters, existing.id, upstream.id)) {
                patch.parent_router_id = upstream.id;
                patch.uplink_interface = nb.iface;
                existing.parent_router_id = upstream.id;
              }
            } else if (nb.iface && existing.parent_router_id === upstream.id) {
              patch.uplink_interface = nb.iface;
            }
            if (nb.ip && !existing.wan_ip) patch.wan_ip = nb.ip;
            if (nb.ip && !existing.lan_ip) patch.lan_ip = nb.ip;
            if (nb.board && !existing.board_name) patch.board_name = nb.board;
            if (nb.version && !existing.firmware_version) patch.firmware_version = nb.version;

            const isChainMonitored = existing.management_method === "chain_neighbor";
            if (isChainMonitored) {
              if (nb.clientCount != null) {
                patch.connected_clients_count = nb.clientCount;
                patch.wireless_clients_count = nb.clientCount;
                patch.clients_updated_at = nowIso;
              }
              if (nb.reachable) {
                patch.status = "online";
                patch.management_status = "online";
                patch.last_seen_at = nowIso;
                patch.last_heartbeat_at = nowIso;

                const { data: closed } = await supabaseAdmin
                  .from("router_uptime_events")
                  .update({ ended_at: nowIso })
                  .eq("router_id", existing.id)
                  .eq("kind", "down")
                  .is("ended_at", null)
                  .select("id");

                if (existing.status === "offline" || (closed?.length ?? 0) > 0) {
                  const roleLabel =
                    existing.node_role === "access_point" ? "Access point" : "Router";
                  alertsToInsert.push({
                    tenant_id: upstream.tenant_id,
                    kind: "router_up",
                    router_id: existing.id,
                    message: `${roleLabel} ${existing.name} (${nb.mac}) on chain under ${upstream.name} is back online`,
                  });
                }
              } else {
                patch.status = "offline";
                patch.management_status = "offline";
                if (existing.status === "online") {
                  const { data: openOutages } = await supabaseAdmin
                    .from("router_uptime_events")
                    .select("id")
                    .eq("router_id", existing.id)
                    .eq("kind", "down")
                    .is("ended_at", null)
                    .limit(1);
                  if (!openOutages?.length) {
                    await supabaseAdmin.from("router_uptime_events").insert({
                      router_id: existing.id,
                      tenant_id: upstream.tenant_id,
                      kind: "down",
                      started_at: existing.last_heartbeat_at ?? existing.last_seen_at ?? nowIso,
                    });
                  }
                  const roleLabel =
                    existing.node_role === "access_point" ? "Access point" : "Router";
                  alertsToInsert.push({
                    tenant_id: upstream.tenant_id,
                    kind: "router_down",
                    router_id: existing.id,
                    message: `${roleLabel} ${existing.name} (${nb.mac}) on chain under ${upstream.name} is offline`,
                  });
                }
              }
            }

            if (Object.keys(patch).length > 0) {
              await supabaseAdmin.from("routers").update(patch).eq("id", existing.id);
            }
            continue;
          }

          if (!autoDiscoveryEnabled) continue;

          // Brand-new MAC address detected on the chain: automatically register it!
          const { nodeRole, vendor } = inferChainNodeType({
            identity: nb.identity,
            platform: nb.platform,
            board: nb.board,
            iface: nb.iface,
          });
          const name = buildChainNodeName({
            identity: nb.identity,
            board: nb.board,
            mac: nb.mac,
            nodeRole,
          });
          const provisionToken =
            vendor === "mikrotik"
              ? `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`
              : null;
          const provisionExpiry =
            provisionToken != null ? new Date(nowMs + 24 * 3600 * 1000).toISOString() : null;

          const { data: inserted, error: insertError } = await supabaseAdmin
            .from("routers")
            .insert({
              tenant_id: upstream.tenant_id,
              name,
              mac_address: nb.mac,
              vendor,
              node_role: nodeRole,
              parent_router_id: upstream.id,
              discovered_by_router_id: upstream.id,
              uplink_interface: nb.iface,
              auto_discovered: true,
              management_method: "chain_neighbor",
              management_status: nb.reachable ? "online" : "offline",
              status: nb.reachable ? "online" : "offline",
              wan_ip: nb.ip,
              lan_ip: nb.ip,
              board_name: nb.board ?? nb.platform,
              device_family: nb.board ?? nb.platform,
              model: nb.board ?? nb.platform,
              firmware_version: nb.version,
              connected_clients_count: nb.clientCount ?? 0,
              wireless_clients_count: nb.clientCount ?? 0,
              clients_updated_at: nowIso,
              last_seen_at: nb.reachable ? nowIso : null,
              last_heartbeat_at: nb.reachable ? nowIso : null,
              provision_token: provisionToken,
              provision_token_expires_at: provisionExpiry,
              legacy_token_auth: false,
            })
            .select("id,name,mac_address,parent_router_id,node_role")
            .maybeSingle();

          if (insertError) {
            // Concurrent report or MAC race: ignore duplicate key, log anything else.
            if (insertError.code !== "23505") {
              console.warn("chain report: auto-add failed", insertError);
            }
            continue;
          }

          if (inserted) {
            seenNeighborRouterIds.add(inserted.id);
            allRouters.push({
              ...inserted,
              tenant_id: upstream.tenant_id,
              discovered_by_router_id: upstream.id,
              management_method: "chain_neighbor",
              status: nb.reachable ? "online" : "offline",
              auto_chain_discovery: true,
              last_heartbeat_at: nb.reachable ? nowIso : null,
              last_seen_at: nb.reachable ? nowIso : null,
              wan_ip: nb.ip,
              lan_ip: nb.ip,
              board_name: nb.board ?? nb.platform,
              firmware_version: nb.version,
              connected_clients_count: nb.clientCount ?? 0,
            });
            byMac.set(nb.mac, allRouters[allRouters.length - 1]);
            const roleLabel = nodeRole === "access_point" ? "Access point" : "Router";
            alertsToInsert.push({
              tenant_id: upstream.tenant_id,
              kind: "chain_node_discovered",
              router_id: inserted.id,
              message: `${roleLabel} ${inserted.name} (${nb.mac}) detected on chain under ${upstream.name}${nb.iface ? ` via ${nb.iface}` : ""} and added automatically`,
            });
          }
        }

        // Mark chain-monitored children that disappeared from neighbor discovery for > 3 minutes as offline.
        const staleCutoffMs = nowMs - 3 * 60 * 1000;
        for (const r of allRouters) {
          if (
            r.management_method === "chain_neighbor" &&
            (r.discovered_by_router_id === upstream.id || r.parent_router_id === upstream.id) &&
            r.status === "online" &&
            !seenNeighborRouterIds.has(r.id)
          ) {
            const last = r.last_heartbeat_at ?? r.last_seen_at;
            if (last && Date.parse(last) < staleCutoffMs) {
              await supabaseAdmin
                .from("routers")
                .update({ status: "offline", management_status: "offline" })
                .eq("id", r.id);

              const { data: openOutages } = await supabaseAdmin
                .from("router_uptime_events")
                .select("id")
                .eq("router_id", r.id)
                .eq("kind", "down")
                .is("ended_at", null)
                .limit(1);
              if (!openOutages?.length) {
                await supabaseAdmin.from("router_uptime_events").insert({
                  router_id: r.id,
                  tenant_id: upstream.tenant_id,
                  kind: "down",
                  started_at: last,
                });
              }

              const roleLabel = r.node_role === "access_point" ? "Access point" : "Router";
              alertsToInsert.push({
                tenant_id: upstream.tenant_id,
                kind: "router_down",
                router_id: r.id,
                message: `${roleLabel} ${r.name}${r.mac_address ? ` (${r.mac_address})` : ""} on chain under ${upstream.name} is offline`,
              });
            }
          }
        }

        if (alertsToInsert.length > 0) {
          const { error: alertError } = await supabaseAdmin
            .from("inventory_alerts")
            .insert(alertsToInsert);
          if (alertError) {
            console.warn("chain report: could not insert alerts", alertError);
          }
        }

        try {
          await dispatchPendingAlerts(upstream.tenant_id);
        } catch {
          /* never fail the router's chain report */
        }

        return new Response("ok", { headers: { "content-type": "text/plain" } });
      },
    },
  },
});
