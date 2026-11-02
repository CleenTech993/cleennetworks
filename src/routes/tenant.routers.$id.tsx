import { createFileRoute, Link, useParams } from "@tanstack/react-router";
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
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { RouterHistory } from "@/components/router-history";
import { fmtUptime, healthScore, healthTone } from "@/lib/router-health";
import { buildDoctorPaste } from "@/lib/router-doctor";
import { syncStatus } from "@/lib/sync-status";
import { InterfacesTab, QualityTab, TrafficTab } from "@/components/router-network";

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
  const { data: r, refetch } = useQuery({
    queryKey: ["router", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("routers").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Tables<"routers"> | null;
    },
    refetchInterval: 2_000,
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
            {live && (
              <Badge
                variant={
                  tone === "good" ? "success" : tone === "warn" ? "warning" : "destructive"
                }
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
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
            <Badge variant="outline" className="text-[10px] h-4 py-0">netgrid-lan</Badge>
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
              <RefreshCw className={`h-3.5 w-3.5 ${live ? "animate-spin-slow text-primary" : ""}`} /> Telemetry Link
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
          <p className="text-[11px] text-muted-foreground mt-1">
            Realtime 2-second streaming sync
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Health</TabsTrigger>
          <TabsTrigger value="interfaces">Interfaces</TabsTrigger>
          <TabsTrigger value="quality">Internet quality</TabsTrigger>
          <TabsTrigger value="traffic">Traffic</TabsTrigger>
        </TabsList>
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
                  sync.level === "ok" ? "bg-card" : sync.level === "warn" ? "border-warning/50 bg-warning/10" : "border-destructive/50 bg-destructive/10"
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
                <Row
                  label="Last heartbeat"
                  value={last ? new Date(last).toLocaleString() : "never"}
                />
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
                  Copy this check, open <b>New Terminal</b> in WinBox (or SSH), paste it and press Enter. It
                  reports in plain words whether the hotspot, PPPoE, internet and sync are working, and
                  what to fix. It only reads; nothing is changed. After the router's next sync you can also
                  just run <code className="rounded bg-muted px-1">/system script run netgrid-doctor</code>.
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
