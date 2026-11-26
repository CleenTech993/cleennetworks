import { createFileRoute, Link, useParams, useRouteContext } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ClipboardCopy,
  Cpu,
  HardDrive,
  RefreshCw,
  Stethoscope,
  Thermometer,
  Zap,
  Globe,
  Wifi,
  Activity,
  Check,
  GitBranch,
  Users,
  Router as RouterIcon,
  Sparkles,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { RouterHistory } from "@/components/router-history";
import { fmtUptime, healthScore, healthTone, isRouterLive } from "@/lib/router-health";
import { buildDoctorPaste } from "@/lib/router-doctor";
import { syncStatus } from "@/lib/sync-status";
import { InterfacesTab, QualityTab, TrafficTab } from "@/components/router-network";
import { RouterSupportSessionButton } from "@/components/router-support-session-button";
import { formatTenantDate } from "@/lib/tenant-customization";
import { CONNECTED_WINDOW_MS, isClientConnected } from "@/lib/pppoe-sessions";
import { wouldCreateChainCycle } from "@/lib/router-chain";

export const Route = createFileRoute("/tenant/routers/$id")({
  head: () => ({
    meta: [
      { title: "Router details — NetGrid" },
      { name: "description", content: "Live router health, ports, internet quality and traffic." },
    ],
  }),
  component: RouterDetail,
});

function RouterDetail() {
  const { id } = useParams({ from: "/tenant/routers/$id" });
  const { roles } = useRouteContext({ from: "/tenant" });
  const { data: r, refetch } = useQuery({
    queryKey: ["router", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("routers").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Tables<"routers"> | null;
    },
    refetchInterval: 2_000,
  });

  const { data: tenantRouters = [], refetch: refetchTenantRouters } = useQuery({
    queryKey: ["router-chain-peers", r?.tenant_id],
    enabled: !!r?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routers")
        .select("*")
        .eq("tenant_id", r!.tenant_id)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Tables<"routers">[];
    },
    refetchInterval: 5_000,
  });

  const { data: routerHotspotClients = [] } = useQuery({
    queryKey: ["router-live-hotspot", id],
    queryFn: async () => {
      const since = new Date(Date.now() - CONNECTED_WINDOW_MS).toISOString();
      const { data, error } = await supabase
        .from("router_devices")
        .select("id,mac,ip,hostname,voucher_code,authorized,blocked,last_seen_at")
        .eq("router_id", id)
        .eq("authorized", true)
        .eq("blocked", false)
        .gte("last_seen_at", since)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10_000,
  });

  const { data: routerPppoeClients = [] } = useQuery({
    queryKey: ["router-live-pppoe", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,full_name,pppoe_username,last_ip,last_seen_at,status,router_id,last_router_id")
        .eq("customer_type", "pppoe")
        .eq("status", "active")
        .or(`last_router_id.eq.${id},router_id.eq.${id}`);
      if (error) throw error;
      return (data ?? []).filter((c) => isClientConnected(c.last_seen_at));
    },
    refetchInterval: 10_000,
  });

  // Re-fetch the moment the router pushes a heartbeat or sync update
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`router-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "routers", filter: `id=eq.${id}` },
        () => void refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [id, refetch]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 2_000);
    return () => clearInterval(i);
  }, []);

  if (!r) {
    return (
      <div>
        <PageHeader title="Router" description="Loading…" />
      </div>
    );
  }

  const last = r.last_heartbeat_at ?? r.last_seen_at;
  const live = last ? Date.now() - new Date(last).getTime() < 3 * 60 * 1000 : false;
  const score = healthScore(r);
  const tone = healthTone(score);
  const ramPct =
    r.total_memory_mb && r.free_memory_mb != null
      ? Math.round(((r.total_memory_mb - r.free_memory_mb) / r.total_memory_mb) * 100)
      : (r.ram_usage ?? null);

  const primaryIp = r.wan_ip ?? r.public_ip ?? null;

  return (
    <div>
      <Link
        to="/tenant/routers"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All routers
      </Link>
      <PageHeader
        title={r.name}
        description={`${r.board_name ?? r.model ?? "MikroTik Router"} · RouterOS v${r.routeros_version ?? "?"} · ${r.architecture ?? ""}`}
        action={
          <div className="flex items-center gap-2">
            {roles.includes("tenant_admin") && <RouterSupportSessionButton routerId={r.id} />}
            {live && (
              <Badge
                variant={tone === "good" ? "success" : tone === "warn" ? "warning" : "destructive"}
              >
                Health {score}%
              </Badge>
            )}
            <Badge
              variant={live ? "default" : "secondary"}
              className={
                live
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                  : ""
              }
            >
              {live ? "online" : "offline"}
            </Badge>
          </div>
        }
      />

      {/* Enterprise Network Status & IP Command Center Banner */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* WAN IP Card */}
        <div className="rounded-xl border bg-card p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-primary" /> WAN IP Address
            </span>
            {live && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Reachable
              </span>
            )}
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="font-mono text-base font-semibold text-foreground tracking-tight">
              {primaryIp ?? "Pending IP"}
            </span>
            {primaryIp && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => {
                  navigator.clipboard.writeText(primaryIp);
                  toast.success("WAN IP copied");
                }}
                title="Copy WAN IP"
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">
            {r.public_ip && r.wan_ip && r.public_ip !== r.wan_ip
              ? `Public ingress: ${r.public_ip}`
              : "Primary WAN interface"}
          </p>
        </div>

        {/* Hotspot / LAN Gateway IP Card */}
        <div className="rounded-xl border bg-card p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <Wifi className="h-3.5 w-3.5 text-emerald-500" /> Hotspot / LAN IP
            </span>
            <Badge variant="outline" className="text-[10px] h-4 py-0">
              netgrid-lan
            </Badge>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="font-mono text-base font-semibold text-foreground tracking-tight">
              {r.lan_ip ?? "10.5.50.1"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => {
                navigator.clipboard.writeText(r.lan_ip ?? "10.5.50.1");
                toast.success("LAN IP copied");
              }}
              title="Copy LAN IP"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Customer gateway & captive portal
          </p>
        </div>

        {/* System Health Card */}
        <div className="rounded-xl border bg-card p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-amber-500" /> System Health
            </span>
            <span className="text-xs font-mono font-medium">{score}/100</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-base font-semibold text-foreground">
              {live ? "Online & Reachable" : "Not Responding"}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              Up {fmtUptime(r.uptime_seconds)}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {r.temperature != null ? `${r.temperature}°C · ` : ""}
            {r.voltage != null ? `${r.voltage} V · ` : ""}
            RouterOS v{r.routeros_version ?? "?"}
          </p>
        </div>

        {/* Telemetry Stream Card */}
        <div className="rounded-xl border bg-card p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <RefreshCw
                className={`h-3.5 w-3.5 ${live ? "animate-spin-slow text-primary" : ""}`}
              />{" "}
              Telemetry Link
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] gap-1"
              onClick={() => void refetch()}
            >
              <RefreshCw className="h-2.5 w-2.5" /> Ping
            </Button>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm font-medium text-foreground">
              {last
                ? `Updated ${Math.max(0, Math.round((Date.now() - new Date(last).getTime()) / 1000))}s ago`
                : "No telemetry received"}
            </span>
            <span
              className={`h-2.5 w-2.5 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-destructive"}`}
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Realtime 2-second streaming sync</p>
        </div>

        {/* Connected Clients Card */}
        <div className="rounded-xl border bg-card p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-primary" /> Connected Clients
            </span>
            <Badge variant="outline" className="text-[10px] h-4 py-0">
              {r.node_role === "access_point" ? "AP" : "Router"}
            </Badge>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-2xl font-bold tabular-nums text-foreground">
              {Math.max(
                r.connected_clients_count ?? 0,
                routerHotspotClients.length + routerPppoeClients.length,
              )}
            </span>
            <span className="text-[11px] text-muted-foreground font-mono">
              {r.hotspot_clients_count ?? routerHotspotClients.length} HS ·{" "}
              {r.pppoe_clients_count ?? routerPppoeClients.length} PPP
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">
            {r.wireless_clients_count
              ? `${r.wireless_clients_count} wireless stations`
              : "Live active sessions"}
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Health</TabsTrigger>
          <TabsTrigger value="chain">Chain &amp; Clients</TabsTrigger>
          <TabsTrigger value="interfaces">Interfaces</TabsTrigger>
          <TabsTrigger value="quality">Internet quality</TabsTrigger>
          <TabsTrigger value="traffic">Traffic</TabsTrigger>
        </TabsList>
        <TabsContent value="chain">
          <RouterChainTab
            router={r}
            allRouters={tenantRouters}
            hotspotClients={routerHotspotClients}
            pppoeClients={routerPppoeClients}
            onChanged={() => {
              void refetch();
              void refetchTenantRouters();
            }}
          />
        </TabsContent>
        <TabsContent value="interfaces">
          <InterfacesTab routerId={r.id} />
        </TabsContent>
        <TabsContent value="quality">
          <QualityTab routerId={r.id} />
        </TabsContent>
        <TabsContent value="traffic">
          <TrafficTab routerId={r.id} />
        </TabsContent>
        <TabsContent value="overview">
          <div className="grid gap-4 md:grid-cols-4 mb-6">
            <StatCard
              label="CPU"
              value={
                r.cpu_load != null || r.cpu_usage != null ? `${r.cpu_load ?? r.cpu_usage}%` : "—"
              }
            />
            <StatCard
              label="RAM"
              value={ramPct != null ? `${ramPct}%` : "—"}
              hint={r.total_memory_mb ? `${r.total_memory_mb} MB total` : undefined}
            />
            <StatCard
              label="Disk free"
              value={r.hdd_free_mb != null ? `${r.hdd_free_mb} MB` : "—"}
            />
            <StatCard label="Uptime" value={fmtUptime(r.uptime_seconds ?? null)} />
          </div>

          {(() => {
            const sync = syncStatus(r.last_sync_at);
            return (
              <div
                className={`mb-6 rounded-xl border p-4 text-sm ${
                  sync.level === "ok"
                    ? "bg-card"
                    : sync.level === "warn"
                      ? "border-warning/50 bg-warning/10"
                      : "border-destructive/50 bg-destructive/10"
                }`}
              >
                <b>Customer sync: {sync.label}.</b> {sync.detail}
              </div>
            );
          })()}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-card p-5">
              <h3 className="mb-3 font-semibold">Identity</h3>
              <dl className="space-y-2 text-sm">
                <Row label="Model" value={r.model ?? r.board_name ?? "—"} />
                <Row label="Serial" value={r.serial ?? "—"} copyable />
                <Row label="RouterOS" value={r.routeros_version ?? "—"} />
                <Row label="Architecture" value={r.architecture ?? "—"} />
                <Row label="MAC" value={r.mac_address ?? "—"} mono copyable />
              </dl>
            </div>
            <div className="rounded-xl border bg-card p-5">
              <h3 className="mb-3 font-semibold">Network &amp; health</h3>
              <dl className="space-y-2 text-sm">
                <Row label="WAN IP" value={primaryIp ?? "—"} mono copyable />
                {r.public_ip && r.wan_ip && r.public_ip !== r.wan_ip && (
                  <Row label="Public Ingress IP" value={r.public_ip} mono copyable />
                )}
                <Row label="LAN IP" value={r.lan_ip ?? "10.5.50.1"} mono copyable />
                <Row label="Status" value={r.status} />
                <Row
                  label="Temperature"
                  value={r.temperature != null ? `${r.temperature}°C` : "—"}
                  icon={<Thermometer className="h-3.5 w-3.5" />}
                />
                <Row
                  label="Voltage"
                  value={r.voltage != null ? `${r.voltage} V` : "—"}
                  icon={<Zap className="h-3.5 w-3.5" />}
                />
                <Row label="Last heartbeat" value={last ? formatTenantDate(last) : "never"} />
              </dl>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Gauge
              label="CPU load"
              value={r.cpu_load ?? r.cpu_usage ?? null}
              icon={<Cpu className="h-4 w-4" />}
            />
            <Gauge label="Memory" value={ramPct} icon={<HardDrive className="h-4 w-4" />} />
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border bg-card p-5">
            <div>
              <h3 className="font-semibold">Block tethering and hotspot sharing</h3>
              <p className="text-sm text-muted-foreground">
                Stops customers sharing one package through a phone hotspot or their own router.
                Takes effect within about 2 minutes. Turn it off only if a customer legitimately
                needs their own router behind this one.
              </p>
            </div>
            <Switch
              checked={r.block_tethering}
              onCheckedChange={async (on) => {
                const { error } = await supabase
                  .from("routers")
                  .update({ block_tethering: on })
                  .eq("id", r.id);
                if (error) toast.error("Could not change the setting");
                else {
                  toast.success(on ? "Tethering will be blocked" : "Tethering allowed");
                  void refetch();
                }
              }}
            />
          </div>

          <div className="mt-4 rounded-xl border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="flex items-center gap-2 font-semibold">
                  <Stethoscope className="h-4 w-4" /> Customers can't connect?
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Copy this check, open <b>New Terminal</b> in WinBox (or SSH), paste it and press
                  Enter. It reports in plain words whether the hotspot, PPPoE, internet and sync are
                  working, and what to fix. It only reads; nothing is changed. After the router's
                  next sync you can also just run{" "}
                  <code className="rounded bg-muted px-1">/system script run netgrid-doctor</code>.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(buildDoctorPaste());
                  toast.success("Diagnostic script copied");
                }}
              >
                <ClipboardCopy className="h-4 w-4" /> Copy check
              </Button>
            </div>
          </div>

          <div className="mt-6">
            <RouterHistory routerId={r.id} lastHeartbeat={last} createdAt={r.created_at} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RouterChainTab({
  router,
  allRouters,
  hotspotClients,
  pppoeClients,
  onChanged,
}: {
  router: Tables<"routers">;
  allRouters: Tables<"routers">[];
  hotspotClients: {
    id: string;
    mac: string;
    ip: string | null;
    hostname: string | null;
    voucher_code: string | null;
    last_seen_at: string;
  }[];
  pppoeClients: {
    id: string;
    full_name: string | null;
    pppoe_username: string | null;
    last_ip: string | null;
    last_seen_at: string | null;
  }[];
  onChanged: () => void;
}) {
  const [linkChildId, setLinkChildId] = useState<string>("");
  const parent = router.parent_router_id
    ? allRouters.find((item) => item.id === router.parent_router_id)
    : undefined;
  const children = allRouters.filter((item) => item.parent_router_id === router.id);
  const linkable = allRouters.filter(
    (item) =>
      item.id !== router.id &&
      item.parent_router_id !== router.id &&
      !wouldCreateChainCycle(allRouters, item.id, router.id),
  );

  async function attachChild() {
    if (!linkChildId) return;
    const { error } = await supabase
      .from("routers")
      .update({ parent_router_id: router.id })
      .eq("id", linkChildId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Device chained under this router");
    setLinkChildId("");
    onChanged();
  }

  async function unlinkChild(childId: string) {
    const { error } = await supabase
      .from("routers")
      .update({ parent_router_id: null })
      .eq("id", childId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Device unlinked from this chain");
    onChanged();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" /> Chain Position
            </h3>
            {router.auto_discovered && (
              <Badge variant="outline" className="text-xs gap-1">
                <Sparkles className="h-3 w-3" /> Auto-detected
              </Badge>
            )}
          </div>
          <dl className="space-y-2 text-sm">
            <Row
              label="Device Role"
              value={router.node_role === "access_point" ? "Access Point" : "Router"}
            />
            <Row label="Detected MAC" value={router.mac_address ?? "Pending"} mono copyable />
            <Row label="Uplink Port" value={router.uplink_interface ?? "—"} mono />
            <div className="flex items-center justify-between gap-3 py-0.5">
              <dt className="text-muted-foreground">Upstream Parent</dt>
              <dd>
                {parent ? (
                  <Link
                    to="/tenant/routers/$id"
                    params={{ id: parent.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    {parent.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Root gateway</span>
                )}
              </dd>
            </div>
          </dl>
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <div>
              <p className="text-sm font-medium">Auto-detect downstream devices</p>
              <p className="text-xs text-muted-foreground">
                Automatically add routers &amp; APs plugged into this router by MAC address.
              </p>
            </div>
            <Switch
              checked={router.auto_chain_discovery !== false}
              onCheckedChange={async (on) => {
                const { error } = await supabase
                  .from("routers")
                  .update({ auto_chain_discovery: on })
                  .eq("id", router.id);
                if (error) toast.error("Could not update auto-discovery setting");
                else {
                  toast.success(on ? "Auto-discovery enabled" : "Auto-discovery paused");
                  onChanged();
                }
              }}
            />
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Client Breakdown
            </h3>
            <Badge variant="outline" className="font-mono text-xs">
              Total: {router.connected_clients_count ?? 0}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Hotspot</p>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {Math.max(router.hotspot_clients_count ?? 0, hotspotClients.length)}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">PPPoE</p>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {Math.max(router.pppoe_clients_count ?? 0, pppoeClients.length)}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Wireless</p>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {router.wireless_clients_count ?? 0}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {router.clients_updated_at
              ? `Last client sample: ${formatTenantDate(router.clients_updated_at)}`
              : "Counts refresh automatically every minute from router telemetry."}
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Downstream Chained Routers &amp; Access Points</h3>
            <p className="text-xs text-muted-foreground">
              Devices connected below {router.name} in the network chain.
            </p>
          </div>
          {linkable.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={linkChildId} onValueChange={setLinkChildId}>
                <SelectTrigger className="h-8 w-52 text-xs">
                  <SelectValue placeholder="Chain existing device…" />
                </SelectTrigger>
                <SelectContent>
                  {linkable.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({item.node_role === "access_point" ? "AP" : "Router"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={attachChild}
                disabled={!linkChildId}
              >
                Chain
              </Button>
            </div>
          )}
        </div>

        {children.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No downstream devices chained yet. Plug a router or access point into {router.name} to
            detect its MAC and add it automatically, or select one above.
          </p>
        ) : (
          <div className="divide-y rounded-lg border">
            {children.map((child) => {
              const childLive = isRouterLive(child);
              return (
                <div
                  key={child.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`grid h-8 w-8 place-items-center rounded-md border ${
                        childLive
                          ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-600 border-rose-500/20"
                      }`}
                    >
                      {child.node_role === "access_point" ? (
                        <Wifi className="h-4 w-4" />
                      ) : (
                        <RouterIcon className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          to="/tenant/routers/$id"
                          params={{ id: child.id }}
                          className="font-medium hover:underline truncate"
                        >
                          {child.name}
                        </Link>
                        <Badge
                          variant={childLive ? "default" : "destructive"}
                          className="text-[10px]"
                        >
                          {childLive ? "online" : "offline"}
                        </Badge>
                        {child.auto_discovered && (
                          <Badge variant="outline" className="text-[10px]">
                            auto-added
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">
                        {child.mac_address ?? "No MAC"}
                        {child.uplink_interface ? ` · via ${child.uplink_interface}` : ""}
                        {child.wan_ip ? ` · ${child.wan_ip}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs gap-1">
                      <Users className="h-3 w-3" />
                      {child.connected_clients_count ?? 0} clients
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => void unlinkChild(child.id)}
                    >
                      Unlink
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-3">
        <h3 className="font-semibold">Live Connected Clients on {router.name}</h3>
        {hotspotClients.length === 0 && pppoeClients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active hotspot or PPPoE client sessions reported in the last 3 minutes.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Client / Hostname</th>
                  <th className="px-4 py-2">Service</th>
                  <th className="px-4 py-2">IP</th>
                  <th className="px-4 py-2">Identifier / MAC</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pppoeClients.map((c) => (
                  <tr key={`pppoe-${c.id}`}>
                    <td className="px-4 py-2 font-medium">{c.full_name || c.pppoe_username}</td>
                    <td className="px-4 py-2">PPPoE</td>
                    <td className="px-4 py-2 font-mono text-xs">{c.last_ip ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{c.pppoe_username ?? "—"}</td>
                  </tr>
                ))}
                {hotspotClients.map((d) => (
                  <tr key={`hs-${d.id}`}>
                    <td className="px-4 py-2 font-medium">
                      {d.hostname || d.voucher_code || "Hotspot client"}
                    </td>
                    <td className="px-4 py-2">Hotspot</td>
                    <td className="px-4 py-2 font-mono text-xs">{d.ip ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{d.mac}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  icon,
  copyable,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  icon?: React.ReactNode;
  copyable?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className={`flex items-center gap-1.5 ${mono ? "font-mono text-xs" : ""}`}>
        <span>{value}</span>
        {copyable && value !== "—" && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(String(value));
              toast.success(`${label} copied`);
            }}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
            title={`Copy ${label}`}
          >
            <ClipboardCopy className="h-3 w-3" />
          </button>
        )}
      </dd>
    </div>
  );
}

function Gauge({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
}) {
  const pct = value ?? 0;
  const color = pct > 80 ? "bg-destructive" : pct > 60 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-2 flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="font-medium">{value != null ? `${value}%` : "—"}</div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
