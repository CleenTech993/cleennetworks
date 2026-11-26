import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Cpu,
  HardDrive,
  Router as RouterIcon,
  Wifi,
  Globe,
  Radio,
  Server,
  Zap,
  Network,
  Users,
  ShieldCheck,
  AlertTriangle,
  ArrowUpRight,
  RefreshCw,
  Gauge,
  Thermometer,
  GitBranch,
  Sparkles,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fmtUptime, healthScore, healthTone, isRouterLive } from "@/lib/router-health";
import { RouterFleetSlaCard } from "@/components/router-fleet-sla-card";
import { CONNECTED_WINDOW_MS, isClientConnected } from "@/lib/pppoe-sessions";
import { formatTenantDate } from "@/lib/tenant-customization";
import { buildChainTree, type ChainTreeNode } from "@/lib/router-chain";

function formatRate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 bps";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbps`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} Kbps`;
  return `${Math.round(value)} bps`;
}

export const Route = createFileRoute("/tenant/noc")({
  head: () => ({
    meta: [
      { title: "NOC Network Monitor — Tenant Console" },
      {
        name: "description",
        content: "Real-time Network Operations Center, topology, router matrix, and traffic.",
      },
    ],
  }),
  component: TenantNocPage,
});

export function TenantNocPage() {
  const { tenantId } = useAuth();

  const {
    data: routers,
    refetch: refetchRouters,
    isLoading: loadingRouters,
  } = useQuery({
    queryKey: ["tenant-noc-routers", tenantId],
    queryFn: async () => {
      let q = supabase.from("routers").select("*").order("name");

      if (tenantId) {
        q = q.eq("tenant_id", tenantId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 3_000,
  });

  const { data: pppoeCustomers } = useQuery({
    queryKey: ["tenant-noc-pppoe", tenantId],
    queryFn: async () => {
      let q = supabase
        .from("customers")
        .select(
          "id,full_name,phone,pppoe_username,status,expires_at,last_seen_at,last_router_id,router_id,last_ip,download_bps,upload_bps",
        )
        .eq("customer_type", "pppoe");

      if (tenantId) {
        q = q.eq("tenant_id", tenantId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10_000,
  });

  const { data: hotspotDevices } = useQuery({
    queryKey: ["tenant-noc-hotspot-devices", tenantId],
    queryFn: async () => {
      let q = supabase
        .from("router_devices")
        .select(
          "id,router_id,mac,ip,hostname,voucher_code,authorized,blocked,last_seen_at,download_bps,upload_bps",
        )
        .eq("authorized", true)
        .eq("blocked", false)
        .gte("last_seen_at", new Date(Date.now() - CONNECTED_WINDOW_MS).toISOString());

      if (tenantId) {
        q = q.eq("tenant_id", tenantId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10_000,
  });

  // Supabase Realtime channel subscription for immediate updates
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`noc-monitor-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "routers", filter: `tenant_id=eq.${tenantId}` },
        () => {
          void refetchRouters();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [tenantId, refetchRouters]);

  // Re-evaluate live state every 2 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 2_000);
    return () => clearInterval(i);
  }, []);

  const routerList = useMemo(() => routers ?? [], [routers]);
  const onlineRouters = useMemo(() => routerList.filter(isRouterLive), [routerList]);
  const offlineRouters = useMemo(() => routerList.filter((r) => !isRouterLive(r)), [routerList]);

  // Aggregated traffic
  const avgCpu = useMemo(() => {
    if (onlineRouters.length === 0) return 0;
    const total = onlineRouters.reduce((acc, r) => acc + (r.cpu_load ?? r.cpu_usage ?? 0), 0);
    return Math.round(total / onlineRouters.length);
  }, [onlineRouters]);

  // PPPoE active counts
  const now = Date.now();
  const liveRouterIds = useMemo(
    () => new Set(onlineRouters.map((router) => router.id)),
    [onlineRouters],
  );
  const onlinePppoeCustomers = useMemo(
    () =>
      (pppoeCustomers ?? []).filter((customer) => {
        const routerId = customer.last_router_id ?? customer.router_id;
        const expiry = customer.expires_at ? Date.parse(customer.expires_at) : Infinity;
        return (
          customer.status === "active" &&
          expiry > now &&
          isClientConnected(customer.last_seen_at, now) &&
          !!routerId &&
          liveRouterIds.has(routerId)
        );
      }),
    [pppoeCustomers, now, liveRouterIds],
  );
  const onlineHotspotDevices = useMemo(
    () =>
      (hotspotDevices ?? []).filter(
        (device) =>
          device.authorized &&
          !device.blocked &&
          isClientConnected(device.last_seen_at, now) &&
          liveRouterIds.has(device.router_id),
      ),
    [hotspotDevices, now, liveRouterIds],
  );
  const onlineClientRows = useMemo(
    () => [
      ...onlinePppoeCustomers.map((customer) => ({
        key: `pppoe:${customer.id}`,
        kind: "PPPoE",
        name: customer.full_name || customer.pppoe_username || "PPPoE customer",
        detail: customer.pppoe_username || customer.phone || "—",
        ip: customer.last_ip,
        downloadBps: Number(customer.download_bps ?? 0),
        uploadBps: Number(customer.upload_bps ?? 0),
        lastSeen: customer.last_seen_at,
      })),
      ...onlineHotspotDevices.map((device) => ({
        key: `hotspot:${device.id}`,
        kind: "Hotspot",
        name: device.hostname || device.voucher_code || "Hotspot device",
        detail: device.mac,
        ip: device.ip,
        downloadBps: Number(device.download_bps ?? 0),
        uploadBps: Number(device.upload_bps ?? 0),
        lastSeen: device.last_seen_at,
      })),
    ],
    [onlinePppoeCustomers, onlineHotspotDevices],
  );
  const totalDownloadBps = onlineClientRows.reduce((sum, client) => sum + client.downloadBps, 0);
  const totalUploadBps = onlineClientRows.reduce((sum, client) => sum + client.uploadBps, 0);
  const activePppoeCount = onlinePppoeCustomers.length;
  const activeHotspotCount = onlineHotspotDevices.length;
  const routerById = useMemo(() => new Map(routerList.map((r) => [r.id, r])), [routerList]);
  const chainForest = useMemo(() => buildChainTree(routerList, now), [routerList, now]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Network Operations Center (NOC)"
        description="Real-time multi-router health matrix, visual topology, subscriber distribution, and bandwidth throughput."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchRouters()}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Link to="/tenant/tools">
              <Button size="sm" variant="default" className="text-xs">
                Open Diagnostics Tool
              </Button>
            </Link>
          </div>
        }
      />

      {/* Primary NOC KPI Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Routers"
          value={routerList.length}
          hint={`${onlineRouters.length} operational`}
          icon={RouterIcon}
        />
        <div className="rounded-xl border bg-card p-5 relative overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-muted-foreground">Fleet Status</p>
            <span className="relative flex h-3 w-3">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${offlineRouters.length > 0 ? "bg-red-400" : "bg-emerald-400"}`}
              />
              <span
                className={`relative inline-flex rounded-full h-3 w-3 ${offlineRouters.length > 0 ? "bg-red-500" : "bg-emerald-500"}`}
              />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold tracking-tight ${offlineRouters.length > 0 ? "text-amber-500" : "text-emerald-500"}`}
            >
              {routerList.length
                ? Math.round((onlineRouters.length / routerList.length) * 100)
                : 100}
              %
            </span>
            <span className="text-xs text-muted-foreground">Network Uptime</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {offlineRouters.length > 0
              ? `${offlineRouters.length} router(s) offline`
              : "All router heartbeats nominal"}
          </p>
        </div>
        <StatCard
          label="Avg CPU Load"
          value={`${avgCpu}%`}
          hint={avgCpu > 75 ? "High load warning" : "Normal operating range"}
          icon={Cpu}
        />
        <StatCard
          label="Active Connected Users"
          value={activeHotspotCount + activePppoeCount}
          hint={`${activeHotspotCount} Hotspot · ${activePppoeCount} PPPoE`}
          icon={Users}
        />
      </div>

      <RouterFleetSlaCard tenantId={tenantId} routers={routerList} />

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h3 className="font-semibold">Online customers</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Active hotspot and PPPoE sessions reported by live routers; traffic rates refresh with
              router samples.
            </p>
          </div>
          <div className="text-right text-xs">
            <p>↓ {formatRate(totalDownloadBps)}</p>
            <p>↑ {formatRate(totalUploadBps)}</p>
          </div>
        </div>
        {onlineClientRows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            No online customers reported. Router reports refresh about once per minute.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Customer / device</th>
                  <th className="px-5 py-3">Service</th>
                  <th className="px-5 py-3">IP address</th>
                  <th className="px-5 py-3 text-right">Download</th>
                  <th className="px-5 py-3 text-right">Upload</th>
                  <th className="px-5 py-3 text-right">Last report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {onlineClientRows.map((client) => (
                  <tr key={client.key}>
                    <td className="px-5 py-3">
                      <p className="font-medium">{client.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{client.detail}</p>
                    </td>
                    <td className="px-5 py-3">{client.kind}</td>
                    <td className="px-5 py-3 font-mono text-xs">{client.ip ?? "—"}</td>
                    <td className="px-5 py-3 text-right">{formatRate(client.downloadBps)}</td>
                    <td className="px-5 py-3 text-right">{formatRate(client.uploadBps)}</td>
                    <td className="px-5 py-3 text-right text-xs text-muted-foreground">
                      {formatTenantDate(client.lastSeen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Network Outage Alert Banner (if any router is down) */}
      {offlineRouters.length > 0 && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-lg bg-red-500/20 text-red-500 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold text-red-600 dark:text-red-400">
                Network Outage Detected: {offlineRouters.length} Router
                {offlineRouters.length > 1 ? "s" : ""} Offline
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                The following devices have stopped transmitting heartbeats:{" "}
                <span className="font-medium text-foreground">
                  {offlineRouters.map((r) => r.name).join(", ")}
                </span>
              </p>
            </div>
          </div>
          <Link to="/tenant/routers">
            <Button size="sm" variant="destructive" className="text-xs shrink-0">
              Troubleshoot Routers
            </Button>
          </Link>
        </div>
      )}

      {/* Interactive Visual Network Topology Map */}
      <div className="rounded-xl border bg-card p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-4 mb-6">
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary animate-pulse" />
              Live Router &amp; Access Point Chain Topology
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Real-time chain hierarchy from Cloud Hub through gateway routers to downstream routers
              and access points, with live connected client counts and auto-detected MACs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="w-fit text-xs gap-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Realtime Synced
            </Badge>
            <Link to="/tenant/routers">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                <GitBranch className="h-3 w-3" /> Edit Chains
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row items-center justify-between gap-6 py-2 px-2 mb-6 rounded-xl bg-muted/20 border p-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Platform Core
              </p>
              <p className="font-bold text-sm">NetGrid Cloud Hub</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span>
              <strong>{onlineRouters.length}</strong> / {routerList.length} nodes online
            </span>
            <span>·</span>
            <span>
              <strong>{onlineClientRows.length}</strong> active subscribers
            </span>
            <span>·</span>
            <span>
              ↓ {formatRate(totalDownloadBps)} · ↑ {formatRate(totalUploadBps)}
            </span>
          </div>
        </div>

        {chainForest.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No routers or access points registered yet. Add a root router to start building your
            chain.
          </p>
        ) : (
          <div className="space-y-4">
            {chainForest.map((node) => (
              <ChainTopologyBranch key={node.router.id} node={node} />
            ))}
          </div>
        )}
      </div>

      {/* Routers Live NOC Status Matrix */}
      <div className="rounded-xl border bg-card">
        <div className="border-b px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">Router Health & Hardware Matrix</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live CPU, Memory, WAN/LAN IPs, and active session count for every deployed router.
            </p>
          </div>
          <Link to="/tenant/routers">
            <Button size="sm" variant="outline" className="gap-1 text-xs">
              Manage Routers <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>

        {routerList.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No routers provisioned yet. Add your first router from the Routers page.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Router / AP</th>
                  <th className="px-4 py-3">Chain &amp; MAC</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Clients</th>
                  <th className="px-4 py-3">IP Addresses</th>
                  <th className="px-4 py-3">CPU Load</th>
                  <th className="px-4 py-3">Memory / Uptime</th>
                  <th className="px-4 py-3">Hardware Info</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {routerList.map((r) => {
                  const live = isRouterLive(r);
                  const cpu = r.cpu_load ?? r.cpu_usage ?? 0;
                  const memoryMb = r.total_memory_mb ?? 0;
                  const freeMb = r.free_memory_mb ?? 0;
                  const usedMemPct =
                    memoryMb > 0 ? Math.round(((memoryMb - freeMb) / memoryMb) * 100) : 0;
                  const parent = r.parent_router_id
                    ? routerById.get(r.parent_router_id)
                    : undefined;
                  const isAp = r.node_role === "access_point";

                  return (
                    <tr key={r.id} className="hover:bg-muted/20 transition-colors align-top">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                          {isAp ? (
                            <Wifi className="h-4 w-4 text-primary" />
                          ) : (
                            <RouterIcon className="h-4 w-4 text-muted-foreground" />
                          )}
                          <Link
                            to="/tenant/routers/$id"
                            params={{ id: r.id }}
                            className="hover:underline"
                          >
                            {r.name}
                          </Link>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="outline" className="text-[10px]">
                            {isAp ? "Access Point" : "Router"}
                          </Badge>
                          {r.auto_discovered && (
                            <Badge variant="outline" className="text-[10px]">
                              Auto-detected
                            </Badge>
                          )}
                          {r.tags?.map((t) => (
                            <span
                              key={t}
                              className="text-[10px] bg-muted px-1.5 py-0.2 rounded text-muted-foreground"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {parent ? (
                          <div className="flex items-center gap-1 text-foreground">
                            <GitBranch className="h-3 w-3 text-primary shrink-0" />
                            <span>{parent.name}</span>
                            {r.uplink_interface && (
                              <span className="font-mono text-[11px] text-muted-foreground">
                                ({r.uplink_interface})
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Root gateway</span>
                        )}
                        <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
                          {r.mac_address ?? "MAC pending"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {live ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            Online
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400 border border-red-500/25">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                            Offline
                          </span>
                        )}
                        <div className="text-[11px] text-muted-foreground mt-1">
                          {r.last_heartbeat_at
                            ? `Heartbeat ${formatTenantDate(r.last_heartbeat_at)}`
                            : "No heartbeats yet"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-semibold tabular-nums flex items-center gap-1">
                          <Users className="h-3.5 w-3.5 text-primary" />
                          {r.connected_clients_count ?? 0}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {r.hotspot_clients_count ?? 0} HS · {r.pppoe_clients_count ?? 0} PPP
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">
                        <div>
                          <span className="text-muted-foreground font-sans text-[11px]">WAN: </span>
                          <span className="font-semibold text-foreground">{r.wan_ip ?? "—"}</span>
                        </div>
                        <div className="mt-0.5">
                          <span className="text-muted-foreground font-sans text-[11px]">LAN: </span>
                          <span>{r.lan_ip ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 w-40">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Load</span>
                          <span
                            className={`font-semibold ${cpu > 80 ? "text-red-500" : cpu > 50 ? "text-amber-500" : "text-foreground"}`}
                          >
                            {cpu}%
                          </span>
                        </div>
                        <Progress value={cpu} className="h-1.5" />
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div>
                          Uptime:{" "}
                          <span className="font-medium text-foreground">
                            {r.uptime_seconds ? fmtUptime(r.uptime_seconds) : "—"}
                          </span>
                        </div>
                        {memoryMb > 0 && (
                          <div className="text-muted-foreground mt-0.5">
                            RAM: {Math.round(freeMb)}MB free ({usedMemPct}% used)
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-medium text-foreground">
                          {r.board_name ?? r.model ?? "MikroTik"}
                        </div>
                        <div className="text-muted-foreground">
                          {r.routeros_version ? `RouterOS ${r.routeros_version}` : "RouterOS"}
                        </div>
                        {r.temperature && (
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                            <Thermometer className="h-3 w-3 text-amber-500" />
                            {r.temperature}°C
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link to="/tenant/routers/$id" params={{ id: r.id }}>
                          <Button size="sm" variant="ghost" className="h-8 text-xs">
                            Details
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ChainTopologyBranch({ node }: { node: ChainTreeNode }) {
  const r = node.router;
  const isAp = r.node_role === "access_point";
  const primaryIp = r.wan_ip ?? r.lan_ip ?? r.public_ip ?? null;

  return (
    <div className={node.depth > 0 ? "pl-6 border-l-2 border-dashed border-border ml-4" : ""}>
      <div
        className={`rounded-xl border p-3.5 transition-colors ${
          node.live ? "bg-card border-border" : "bg-rose-500/5 border-rose-500/40"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${
                node.live
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25"
              }`}
            >
              {isAp ? <Wifi className="h-4 w-4" /> : <RouterIcon className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/tenant/routers/$id"
                  params={{ id: r.id }}
                  className="font-semibold text-sm hover:underline truncate"
                >
                  {r.name}
                </Link>
                <Badge variant={node.live ? "default" : "destructive"} className="text-[10px]">
                  {node.live ? "online" : "offline"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {isAp ? "Access Point" : "Router"}
                </Badge>
                {r.auto_discovered && (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Sparkles className="h-2.5 w-2.5" /> Auto-added
                  </Badge>
                )}
                {node.offlineAncestorName && (
                  <Badge variant="destructive" className="text-[10px]">
                    Upstream {node.offlineAncestorName} offline
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                MAC: {r.mac_address ?? "Pending"}
                {primaryIp ? ` · ${primaryIp}` : ""}
                {r.uplink_interface ? ` · Uplink ${r.uplink_interface}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs gap-1">
              <Users className="h-3 w-3 text-primary" />
              {node.directClients} {node.directClients === 1 ? "client" : "clients"}
            </Badge>
            {node.children.length > 0 && (
              <Badge variant="secondary" className="font-mono text-xs gap-1">
                <GitBranch className="h-3 w-3" />
                {node.children.length} chained · {node.branchClients} total
              </Badge>
            )}
          </div>
        </div>
      </div>

      {node.children.length > 0 && (
        <div className="mt-2.5 space-y-2.5">
          {node.children.map((child) => (
            <ChainTopologyBranch key={child.router.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}
