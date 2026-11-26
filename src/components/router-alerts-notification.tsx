import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  AlertTriangle,
  CheckCircle2,
  Router as RouterIcon,
  ExternalLink,
  ShieldAlert,
  GitBranch,
  Wifi,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { isRouterLive } from "@/lib/router-health";
import { logAudit } from "@/lib/audit";

interface RouterStatus {
  id: string;
  name: string;
  status: string;
  tenant_id: string | null;
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
  node_role?: string | null;
  parent_router_id?: string | null;
  uplink_interface?: string | null;
  mac_address?: string | null;
  connected_clients_count?: number | null;
}

interface ChainAlertRow {
  id: number;
  kind: string;
  message: string;
  router_id: string | null;
  created_at: string;
}

interface LoginSecurityAlert {
  id: string;
  action: string;
  description: string;
  actor_email: string | null;
  created_at: string;
}

const LOGIN_SECURITY_ACTIONS = ["new_login_location", "repeated_failed_logins"];
const CHAIN_ALERT_KINDS = ["router_down", "router_up", "chain_node_discovered"];

export function RouterAlertsNotification({
  tenantId,
  isSuperAdmin = false,
}: {
  tenantId?: string | null;
  isSuperAdmin?: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const prevLiveMap = useRef<Map<string, boolean>>(new Map());
  const initialLoadDone = useRef(false);
  const seenAlertIds = useRef<Set<number>>(new Set());
  const initialAlertsDone = useRef(false);

  const { data: routers } = useQuery({
    queryKey: ["routers-alert-monitor", tenantId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("routers")
        .select(
          "id, name, status, tenant_id, last_heartbeat_at, last_seen_at, node_role, parent_router_id, uplink_interface, mac_address, connected_clients_count",
        )
        .order("name");

      if (tenantId && !isSuperAdmin) {
        q = q.eq("tenant_id", tenantId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as RouterStatus[];
    },
    refetchInterval: 5_000,
  });

  const { data: chainAlerts = [] } = useQuery({
    queryKey: ["chain-alerts-feed", tenantId ?? "all"],
    enabled: !isSuperAdmin,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      let q = supabase
        .from("inventory_alerts")
        .select("id,kind,message,router_id,created_at")
        .in("kind", CHAIN_ALERT_KINDS)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ChainAlertRow[];
    },
    refetchInterval: 10_000,
  });

  const { data: securityAlerts = [] } = useQuery({
    queryKey: ["login-security-alerts"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id,action,description,actor_email,created_at")
        .eq("resource_type", "auth")
        .in("action", LOGIN_SECURITY_ACTIONS)
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as LoginSecurityAlert[];
    },
    refetchInterval: 15_000,
  });

  // Re-evaluate router liveness every 3 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 3_000);
    return () => clearInterval(timer);
  }, []);

  // Realtime subscription on routers and inventory_alerts tables
  useEffect(() => {
    const channelName = tenantId ? `alert-routers-${tenantId}` : "alert-routers-all";
    const ch = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "routers",
          ...(tenantId && !isSuperAdmin ? { filter: `tenant_id=eq.${tenantId}` } : {}),
        },
        () => void qc.invalidateQueries({ queryKey: ["routers-alert-monitor"] }),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "inventory_alerts",
          ...(tenantId && !isSuperAdmin ? { filter: `tenant_id=eq.${tenantId}` } : {}),
        },
        () => void qc.invalidateQueries({ queryKey: ["chain-alerts-feed"] }),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [tenantId, isSuperAdmin, qc]);

  const routerById = useMemo(() => new Map((routers ?? []).map((r) => [r.id, r])), [routers]);

  // Surface newly discovered chain nodes via toast
  useEffect(() => {
    if (!chainAlerts.length) return;
    if (!initialAlertsDone.current) {
      for (const a of chainAlerts) seenAlertIds.current.add(a.id);
      initialAlertsDone.current = true;
      return;
    }
    for (const a of chainAlerts) {
      if (seenAlertIds.current.has(a.id)) continue;
      seenAlertIds.current.add(a.id);
      if (a.kind === "chain_node_discovered") {
        toast.info("New device added to chain", {
          description: a.message,
          duration: 8000,
          action: a.router_id
            ? {
                label: "Inspect",
                onClick: () => {
                  void navigate({ to: `/tenant/routers/${a.router_id}` });
                },
              }
            : undefined,
        });
      }
    }
  }, [chainAlerts, navigate]);

  // Evaluate transitions from online -> offline or offline -> online
  useEffect(() => {
    if (!routers) return;

    const activeRouters = routers.filter((r) => r.status !== "pending");

    if (!initialLoadDone.current) {
      activeRouters.forEach((r) => {
        prevLiveMap.current.set(r.id, isRouterLive(r));
      });
      initialLoadDone.current = true;
      return;
    }

    activeRouters.forEach((r) => {
      const currentlyLive = isRouterLive(r);
      const wasLive = prevLiveMap.current.get(r.id);
      const parent = r.parent_router_id ? routerById.get(r.parent_router_id) : undefined;
      const roleLabel = r.node_role === "access_point" ? "Access Point" : "Router";
      const chainDesc = parent ? ` on chain under ${parent.name}` : "";
      const macDesc = r.mac_address ? ` · MAC ${r.mac_address}` : "";
      const clientsDesc =
        (r.connected_clients_count ?? 0) > 0
          ? ` · ${r.connected_clients_count} client(s) connected`
          : "";

      if (wasLive === true && currentlyLive === false) {
        toast.error(`${roleLabel} Offline${chainDesc}: "${r.name}"`, {
          description: `Heartbeat lost${macDesc}${clientsDesc}.`,
          duration: 8000,
          action: {
            label: "Inspect",
            onClick: () => {
              void navigate({
                to: isSuperAdmin ? "/super-admin/noc" : `/tenant/routers/${r.id}`,
              });
            },
          },
        });

        void logAudit({
          tenantId: r.tenant_id,
          action: "router.offline",
          resourceType: "router",
          resourceId: r.id,
          description: `${roleLabel} "${r.name}" went offline${chainDesc}${macDesc}.`,
        });
      } else if (wasLive === false && currentlyLive === true) {
        toast.success(`${roleLabel} Online${chainDesc}: "${r.name}"`, {
          description: `Connection restored${macDesc}.`,
          duration: 5000,
        });

        void logAudit({
          tenantId: r.tenant_id,
          action: "router.reconnect",
          resourceType: "router",
          resourceId: r.id,
          description: `${roleLabel} "${r.name}" reconnected${chainDesc}.`,
        });
      }

      prevLiveMap.current.set(r.id, currentlyLive);
    });
  }, [routers, routerById, isSuperAdmin, navigate]);

  const configuredRouters = (routers ?? []).filter((r) => r.status !== "pending");
  const offlineRouters = configuredRouters.filter((r) => !isRouterLive(r));
  const hasAlerts = offlineRouters.length > 0;
  const hasSecurityAlerts = isSuperAdmin && securityAlerts.length > 0;
  const recentDiscoveries = !isSuperAdmin
    ? chainAlerts.filter((a) => a.kind === "chain_node_discovered").slice(0, 3)
    : [];
  const alertCount = offlineRouters.length + (hasSecurityAlerts ? securityAlerts.length : 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative h-8 w-8 rounded-full transition-colors ${
            alertCount > 0
              ? "text-rose-500 hover:text-rose-600 bg-rose-500/10 hover:bg-rose-500/20"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-label="System alerts"
          title={alertCount > 0 ? `${alertCount} active alert(s)` : "No active alerts"}
        >
          <Bell className={`h-4 w-4 ${alertCount > 0 ? "animate-bounce" : ""}`} />
          {alertCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white shadow-xs">
              {alertCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0 shadow-lg" align="end">
        <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className={`h-4 w-4 ${alertCount > 0 ? "text-rose-500" : "text-emerald-500"}`}
            />
            <h4 className="font-semibold text-xs">Chain &amp; System Alerts</h4>
          </div>
          {alertCount > 0 ? (
            <Badge variant="destructive" className="text-[10px] h-5 px-1.5 font-mono">
              {alertCount} active
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] h-5 px-1.5 text-emerald-600 border-emerald-500/30"
            >
              All normal
            </Badge>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
          {hasSecurityAlerts && (
            <section>
              <div className="flex items-center gap-2 border-b bg-rose-500/5 px-3 py-2 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                <ShieldAlert className="h-3.5 w-3.5" />
                Login security · last 7 days
              </div>
              {securityAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start justify-between gap-3 p-3 text-xs hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {alert.action === "repeated_failed_logins"
                        ? "Repeated failed sign-ins"
                        : "New login location"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{alert.description}</p>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground">
                      {alert.actor_email ?? "Account not identified"} ·{" "}
                      {new Date(alert.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 gap-1 px-2 text-[11px] text-primary"
                    onClick={() => setOpen(false)}
                  >
                    <Link to="/super-admin/audit">
                      Review <ExternalLink className="h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              ))}
            </section>
          )}
          {hasAlerts ? (
            offlineRouters.map((r) => {
              const last = r.last_heartbeat_at ?? r.last_seen_at;
              const mins = last
                ? Math.round((Date.now() - new Date(last).getTime()) / 60000)
                : null;
              const parent = r.parent_router_id ? routerById.get(r.parent_router_id) : undefined;
              const parentOffline = parent ? !isRouterLive(parent) : false;

              return (
                <div
                  key={r.id}
                  className="p-3 text-xs flex items-start justify-between gap-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                      {r.node_role === "access_point" ? (
                        <Wifi className="h-3 w-3 text-muted-foreground shrink-0" />
                      ) : (
                        <RouterIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate">{r.name}</span>
                    </div>
                    {parent && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                        <GitBranch className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          Under {parent.name}
                          {parentOffline ? " (upstream offline)" : ""}
                        </span>
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {mins != null ? `Offline ${mins}m ago` : "Never checked in"}
                      {r.mac_address ? ` · ${r.mac_address}` : ""}
                    </p>
                    {(r.connected_clients_count ?? 0) > 0 && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                        <Users className="h-2.5 w-2.5" />
                        {r.connected_clients_count} client(s) last connected
                      </p>
                    )}
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] shrink-0 gap-1 text-primary"
                    onClick={() => setOpen(false)}
                  >
                    <Link
                      to={isSuperAdmin ? "/super-admin/noc" : `/tenant/routers/$id`}
                      params={{ id: r.id }}
                    >
                      Check <ExternalLink className="h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              );
            })
          ) : (
            <div className="p-6 text-center text-xs text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2 opacity-80" />
              <p className="font-medium text-foreground">All Chain Nodes Connected</p>
              <p className="text-[11px] mt-0.5">
                {configuredRouters.length} router{configuredRouters.length === 1 ? "" : "s"} / APs
                online across the chain.
              </p>
            </div>
          )}

          {recentDiscoveries.length > 0 && (
            <section className="bg-muted/20">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Recent Auto-Discovered Nodes
              </div>
              {recentDiscoveries.map((a) => (
                <div key={a.id} className="px-3 py-2 text-[11px] border-t border-border/40">
                  <p className="text-foreground">{a.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(a.created_at).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="border-t p-2 bg-muted/20 text-center">
          <Link
            to={isSuperAdmin ? "/super-admin/noc" : "/tenant/routers"}
            onClick={() => setOpen(false)}
            className="text-[11px] text-primary hover:underline font-medium inline-flex items-center gap-1"
          >
            <RouterIcon className="h-3 w-3" /> View all routers &amp; chain
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
