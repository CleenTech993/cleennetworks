import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Cpu,
  HardDrive,
  Router as RouterIcon,
  ShieldCheck,
  Wifi,
  Search,
  Filter,
  LayoutGrid,
  List,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  Terminal,
  ExternalLink,
  Zap,
  Radio,
  Server,
  Layers,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { healthScore, isRouterLive } from "@/lib/router-health";

type RouterRow = Tables<"routers"> & {
  tenantName?: string | null;
  tenantSlug?: string | null;
};

export const Route = createFileRoute("/super-admin/noc")({ component: NocPage });

const isOnline = (r: RouterRow) => isRouterLive(r);

function NocPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedTenant, setSelectedTenant] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline" | "alert">("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [diagnosticsRouter, setDiagnosticsRouter] = useState<RouterRow | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["noc-routers"],
    queryFn: async () => {
      const [routersRes, tenantsRes] = await Promise.all([
        supabase
          .from("routers")
          .select("*")
          .order("last_heartbeat_at", { ascending: false, nullsFirst: false }),
        supabase.from("tenants").select("id,name,slug"),
      ]);
      if (routersRes.error) throw routersRes.error;
      if (tenantsRes.error) throw tenantsRes.error;

      const tmap = new Map((tenantsRes.data ?? []).map((t) => [t.id, t]));
      return {
        routers: (routersRes.data ?? []).map((r) => {
          const t = tmap.get(r.tenant_id);
          return {
            ...r,
            tenantName: t?.name ?? null,
            tenantSlug: t?.slug ?? null,
          };
        }) as RouterRow[],
        tenants: tenantsRes.data ?? [],
      };
    },
    refetchInterval: 25_000,
  });

  // Real-time subscription to router heartbeats
  useEffect(() => {
    const ch = supabase
      .channel("noc-routers-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "routers" }, () => {
        refetch();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [refetch]);

  // Tick every 15s to update uptime & live badges dynamically
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(i);
  }, []);

  const routers = data?.routers ?? [];
  const tenants = data?.tenants ?? [];

  // Filtered routers
  const filteredRouters = useMemo(() => {
    return routers.filter((r) => {
      // Tenant filter
      if (selectedTenant !== "all" && r.tenant_id !== selectedTenant) return false;

      // Status filter
      const live = isOnline(r);
      const cpu = r.cpu_load ?? r.cpu_usage ?? 0;
      if (statusFilter === "online" && !live) return false;
      if (statusFilter === "offline" && live) return false;
      if (statusFilter === "alert" && (!live || cpu < 75)) return false;

      // Search term
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = r.name?.toLowerCase().includes(q);
        const matchesTenant = r.tenantName?.toLowerCase().includes(q);
        const matchesWan = r.wan_ip?.toLowerCase().includes(q) || r.public_ip?.toLowerCase().includes(q);
        const matchesModel = r.model?.toLowerCase().includes(q) || r.board_name?.toLowerCase().includes(q);
        if (!matchesName && !matchesTenant && !matchesWan && !matchesModel) return false;
      }

      return true;
    });
  }, [routers, selectedTenant, statusFilter, search]);

  const onlineCount = routers.filter(isOnline).length;
  const offlineCount = routers.length - onlineCount;
  const degradedRouters = routers.filter((r) => {
    const live = isOnline(r);
    const cpu = r.cpu_load ?? r.cpu_usage ?? 0;
    return live && cpu >= 75;
  });

  const avgCpu =
    routers.length === 0
      ? 0
      : Math.round(
          routers.reduce((s, r) => s + (r.cpu_load ?? r.cpu_usage ?? 0), 0) / routers.length
        );

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(label);
    toast.success(`Copied: ${label}`);
    setTimeout(() => setCopiedCmd(null), 2500);
  };

  const regenTokenMutation = useMutation({
    mutationFn: async (routerId: string) => {
      const newToken = "tok_" + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("routers")
        .update({
          provision_token: newToken,
          provision_token_expires_at: expiresAt,
        })
        .eq("id", routerId);
      if (error) throw error;
      return newToken;
    },
    onSuccess: (newToken) => {
      toast.success("New provision token generated");
      refetch();
      if (diagnosticsRouter) {
        setDiagnosticsRouter({ ...diagnosticsRouter, provision_token: newToken });
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to regenerate token");
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cross-Tenant Global NOC"
        description="Unified real-time network operations center across all ISP tenant MikroTik fleets."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetch();
                toast.success("Fleet status synchronized");
              }}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              {isFetching ? "Syncing…" : "Refresh"}
            </Button>
            <div className="flex items-center rounded-lg border bg-muted p-0.5">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-3.5 w-3.5 mr-1" /> Grid
              </Button>
              <Button
                variant={viewMode === "table" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setViewMode("table")}
              >
                <List className="h-3.5 w-3.5 mr-1" /> Table
              </Button>
            </div>
          </div>
        }
      />

      {/* Fleet Overview Telemetry */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={RouterIcon}
          label="Total Routers Monitored"
          value={routers.length}
          hint={`${tenants.length} tenants provisioned`}
        />
        <StatCard
          icon={Activity}
          label="Fleet Online Rate"
          value={routers.length ? `${Math.round((onlineCount / routers.length) * 100)}%` : "0%"}
          hint={`${onlineCount} connected & sending telemetry`}
        />
        <StatCard
          icon={AlertTriangle}
          label="Alerting / High CPU (>75%)"
          value={degradedRouters.length}
          hint={degradedRouters.length > 0 ? "Requires capacity check" : "Fleet running stable"}
        />
        <StatCard
          icon={Cpu}
          label="Global Fleet Avg CPU"
          value={`${avgCpu}%`}
          hint={`${offlineCount} offline routers`}
        />
      </div>

      {/* Critical Degraded Alerts Banner */}
      {degradedRouters.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>
                <strong>{degradedRouters.length} Router{degradedRouters.length > 1 ? "s" : ""}</strong> experiencing high CPU utilization (&gt;75%).
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-amber-500/30 hover:bg-amber-500/20"
              onClick={() => setStatusFilter("alert")}
            >
              Filter Degraded
            </Button>
          </div>
        </div>
      )}

      {/* Filters & Search Control Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card p-3 rounded-xl border">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search router, tenant, IP, or model…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <Select value={selectedTenant} onValueChange={setSelectedTenant}>
            <SelectTrigger className="w-48 h-9 text-xs">
              <SelectValue placeholder="All Tenants" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tenants ({tenants.length})</SelectItem>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <Button
            variant={statusFilter === "all" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setStatusFilter("all")}
          >
            All ({routers.length})
          </Button>
          <Button
            variant={statusFilter === "online" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs text-emerald-600 dark:text-emerald-400"
            onClick={() => setStatusFilter("online")}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500 mr-1.5" />
            Online ({onlineCount})
          </Button>
          <Button
            variant={statusFilter === "offline" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => setStatusFilter("offline")}
          >
            <span className="h-2 w-2 rounded-full bg-muted-foreground/40 mr-1.5" />
            Offline ({offlineCount})
          </Button>
          <Button
            variant={statusFilter === "alert" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs text-amber-600 dark:text-amber-400"
            onClick={() => setStatusFilter("alert")}
          >
            <span className="h-2 w-2 rounded-full bg-amber-500 mr-1.5" />
            Alerting ({degradedRouters.length})
          </Button>
        </div>
      </div>

      {/* Grid View */}
      {viewMode === "grid" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredRouters.map((r) => {
            const live = isOnline(r);
            const score = healthScore(r);
            const cpu = r.cpu_load ?? r.cpu_usage ?? 0;
            const ramPct =
              r.total_memory_mb && r.free_memory_mb != null
                ? Math.round(((r.total_memory_mb - r.free_memory_mb) / r.total_memory_mb) * 100)
                : (r.ram_usage ?? 0);

            return (
              <div
                key={r.id}
                className={`rounded-xl border bg-card p-5 shadow-sm transition-all hover:border-primary/40 space-y-4 ${
                  !live ? "opacity-75" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          live ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"
                        }`}
                      />
                      <h4 className="font-semibold text-sm tracking-tight">{r.name}</h4>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                        {r.tenantName ?? "General"}
                      </Badge>
                      <span>·</span>
                      <span>{r.board_name ?? r.model ?? "MikroTik"}</span>
                    </div>
                  </div>

                  <Badge
                    variant={live ? "default" : "secondary"}
                    className={`capitalize text-xs ${
                      live ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : ""
                    }`}
                  >
                    {live ? "Online" : "Offline"}
                  </Badge>
                </div>

                {/* Resource Gauges */}
                <div className="space-y-2.5 pt-1">
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span className="flex items-center gap-1">
                        <Cpu className="h-3 w-3" /> CPU Load
                      </span>
                      <span className={`font-mono font-medium ${cpu >= 80 ? "text-red-500" : ""}`}>
                        {live ? `${cpu}%` : "—"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          cpu >= 80 ? "bg-red-500" : cpu >= 50 ? "bg-amber-500" : "bg-primary"
                        }`}
                        style={{ width: live ? `${Math.min(100, Math.max(0, cpu))}%` : "0%" }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span className="flex items-center gap-1">
                        <HardDrive className="h-3 w-3" /> Memory
                      </span>
                      <span className="font-mono font-medium">{live ? `${ramPct}%` : "—"}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 transition-all"
                        style={{ width: live ? `${Math.min(100, Math.max(0, ramPct))}%` : "0%" }}
                      />
                    </div>
                  </div>
                </div>

                {/* Technical Footprint & WAN IP */}
                <div className="rounded-lg bg-muted/40 p-2.5 text-xs font-mono space-y-1">
                  <div className="flex justify-between text-muted-foreground">
                    <span>WAN IP</span>
                    <span className="text-foreground">{r.wan_ip ?? r.public_ip ?? "—"}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>RouterOS</span>
                    <span className="text-foreground">{r.routeros_version ?? "v7.x"}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Health Rating</span>
                    <span className="font-semibold text-foreground">{live ? `${score}%` : "—"}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-muted-foreground">
                    {r.last_heartbeat_at
                      ? `Seen ${new Date(r.last_heartbeat_at).toLocaleTimeString()}`
                      : "Never connected"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDiagnosticsRouter(r)}
                  >
                    <Terminal className="h-3 w-3 mr-1" /> Triage
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table View */}
      {viewMode === "table" && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Router</th>
                  <th className="px-4 py-3 text-left">Tenant ISP</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Health</th>
                  <th className="px-4 py-3 text-left">CPU</th>
                  <th className="px-4 py-3 text-left">RAM</th>
                  <th className="px-4 py-3 text-left">WAN IP</th>
                  <th className="px-4 py-3 text-left">Last Seen</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRouters.map((r) => {
                  const live = isOnline(r);
                  const ramPct =
                    r.total_memory_mb && r.free_memory_mb != null
                      ? Math.round(((r.total_memory_mb - r.free_memory_mb) / r.total_memory_mb) * 100)
                      : (r.ram_usage ?? null);

                  return (
                    <tr key={r.id} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <RouterIcon className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{r.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.board_name ?? r.model ?? "—"} · {r.routeros_version ?? "?"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">
                          {r.tenantName ?? "—"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={live ? "default" : "secondary"}
                          className={`capitalize ${
                            live ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : ""
                          }`}
                        >
                          {live ? "online" : "offline"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-semibold">{live ? `${healthScore(r)}%` : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                          {r.cpu_load ?? r.cpu_usage ?? "—"}
                          {(r.cpu_load ?? r.cpu_usage) != null && "%"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                          {ramPct != null ? `${ramPct}%` : "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{r.wan_ip ?? r.public_ip ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {(r.last_heartbeat_at ?? r.last_seen_at)
                          ? new Date((r.last_heartbeat_at ?? r.last_seen_at)!).toLocaleString()
                          : "never"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setDiagnosticsRouter(r)}
                        >
                          <Terminal className="h-3.5 w-3.5 mr-1" /> Triage
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredRouters.length === 0 && (
        <div className="rounded-xl border bg-card p-12 text-center space-y-2">
          <Wifi className="mx-auto h-8 w-8 text-muted-foreground opacity-40" />
          <h4 className="font-medium text-sm">No routers matched your filter</h4>
          <p className="text-xs text-muted-foreground">
            Try adjusting your search query, tenant selection, or status filters.
          </p>
        </div>
      )}

      {/* Router Diagnostics & CLI Triage Modal */}
      <Dialog open={!!diagnosticsRouter} onOpenChange={(o) => !o && setDiagnosticsRouter(null)}>
        {diagnosticsRouter && (
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="flex items-center gap-2">
                  <Terminal className="h-5 w-5 text-primary" />
                  Router Diagnostics: {diagnosticsRouter.name}
                </DialogTitle>
              </div>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border p-3 bg-muted/30 space-y-1">
                  <div className="text-muted-foreground">Tenant ISP</div>
                  <div className="font-semibold text-sm">{diagnosticsRouter.tenantName ?? "—"}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    ID: {diagnosticsRouter.tenant_id}
                  </div>
                </div>

                <div className="rounded-lg border p-3 bg-muted/30 space-y-1">
                  <div className="text-muted-foreground">Hardware & Firmware</div>
                  <div className="font-semibold text-sm">
                    {diagnosticsRouter.board_name ?? diagnosticsRouter.model ?? "MikroTik"}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    RouterOS {diagnosticsRouter.routeros_version ?? "v7"}
                  </div>
                </div>
              </div>

              {/* MikroTik Diagnostic CLI Helpers */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold">MikroTik RouterOS CLI Diagnostic Commands</Label>
                <div className="space-y-2">
                  {[
                    {
                      label: "Fast Gateway Ping Test",
                      cmd: `/ping 8.8.8.8 count=5`,
                    },
                    {
                      label: "Traceroute Cloud DNS",
                      cmd: `/tool traceroute 1.1.1.1 count=3`,
                    },
                    {
                      label: "Inspect CPU & Resource Utilization",
                      cmd: `/system resource print`,
                    },
                    {
                      label: "Verify Active Heartbeat & Script Schedule",
                      cmd: `/system script print\n/system scheduler print`,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-lg border bg-muted/60 p-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="font-mono text-xs overflow-x-auto whitespace-pre">
                        <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                          {item.label}
                        </span>
                        <code>{item.cmd}</code>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 shrink-0"
                        onClick={() => copyToClipboard(item.cmd, item.label)}
                      >
                        {copiedCmd === item.label ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Provision Token Management */}
              <div className="rounded-lg border p-3 bg-card space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Provisioning Token</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => regenTokenMutation.mutate(diagnosticsRouter.id)}
                    disabled={regenTokenMutation.isPending}
                  >
                    <RefreshCw
                      className={`h-3 w-3 mr-1 ${regenTokenMutation.isPending ? "animate-spin" : ""}`}
                    />
                    Regenerate Token
                  </Button>
                </div>
                <div className="font-mono text-xs bg-muted p-2 rounded break-all select-all">
                  {diagnosticsRouter.provision_token ?? "No active token"}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDiagnosticsRouter(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
