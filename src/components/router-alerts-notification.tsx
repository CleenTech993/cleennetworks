import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, AlertTriangle, CheckCircle2, Router as RouterIcon, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
}

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

  const { data: routers } = useQuery({
    queryKey: ["routers-alert-monitor", tenantId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("routers")
        .select("id, name, status, tenant_id, last_heartbeat_at, last_seen_at")
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

  // Re-evaluate router liveness every 3 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 3_000);
    return () => clearInterval(timer);
  }, []);

  // Realtime subscription on routers table
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
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [tenantId, isSuperAdmin, qc]);

  // Evaluate transitions from online -> offline or offline -> online
  useEffect(() => {
    if (!routers) return;

    // Filter out pending setup routers
    const activeRouters = routers.filter((r) => r.status !== "pending");

    if (!initialLoadDone.current) {
      // First load: initialize map without triggering alert toasts
      activeRouters.forEach((r) => {
        prevLiveMap.current.set(r.id, isRouterLive(r));
      });
      initialLoadDone.current = true;
      return;
    }

    activeRouters.forEach((r) => {
      const currentlyLive = isRouterLive(r);
      const wasLive = prevLiveMap.current.get(r.id);

      if (wasLive === true && currentlyLive === false) {
        // Router disconnected!
        toast.error(`Router Disconnected: "${r.name}"`, {
          description: "No heartbeat received in the last 3 minutes. Router is now offline.",
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
          description: `Router "${r.name}" went offline (heartbeat disconnected).`,
        });
      } else if (wasLive === false && currentlyLive === true) {
        // Router reconnected!
        toast.success(`Router Online: "${r.name}"`, {
          description: "Telemetry heartbeat restored.",
          duration: 5000,
        });

        void logAudit({
          tenantId: r.tenant_id,
          action: "router.reconnect",
          resourceType: "router",
          resourceId: r.id,
          description: `Router "${r.name}" reconnected and is back online.`,
        });
      }

      prevLiveMap.current.set(r.id, currentlyLive);
    });
  }, [routers, isSuperAdmin, navigate]);

  const configuredRouters = (routers ?? []).filter((r) => r.status !== "pending");
  const offlineRouters = configuredRouters.filter((r) => !isRouterLive(r));
  const hasAlerts = offlineRouters.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative h-8 w-8 rounded-full transition-colors ${
            hasAlerts
              ? "text-rose-500 hover:text-rose-600 bg-rose-500/10 hover:bg-rose-500/20"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-label="Router alerts"
          title={hasAlerts ? `${offlineRouters.length} router(s) offline` : "All routers healthy"}
        >
          <Bell className={`h-4 w-4 ${hasAlerts ? "animate-bounce" : ""}`} />
          {hasAlerts && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white shadow-xs">
              {offlineRouters.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0 shadow-lg" align="end">
        <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <AlertTriangle className={`h-4 w-4 ${hasAlerts ? "text-rose-500" : "text-emerald-500"}`} />
            <h4 className="font-semibold text-xs">Router Health Alerts</h4>
          </div>
          {hasAlerts ? (
            <Badge variant="destructive" className="text-[10px] h-5 px-1.5 font-mono">
              {offlineRouters.length} offline
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-emerald-600 border-emerald-500/30">
              All normal
            </Badge>
          )}
        </div>

        <div className="max-h-72 overflow-y-auto divide-y divide-border/60">
          {hasAlerts ? (
            offlineRouters.map((r) => {
              const last = r.last_heartbeat_at ?? r.last_seen_at;
              const mins = last ? Math.round((Date.now() - new Date(last).getTime()) / 60000) : null;

              return (
                <div key={r.id} className="p-3 text-xs flex items-start justify-between gap-3 hover:bg-muted/40 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                      <span className="truncate">{r.name}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {mins != null ? `Disconnected ${mins}m ago` : "Never checked in"}
                    </p>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] shrink-0 gap-1 text-primary"
                    onClick={() => setOpen(false)}
                  >
                    <Link to={isSuperAdmin ? "/super-admin/noc" : `/tenant/routers/$id`} params={{ id: r.id }}>
                      Check <ExternalLink className="h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              );
            })
          ) : (
            <div className="p-6 text-center text-xs text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2 opacity-80" />
              <p className="font-medium text-foreground">All Routers Connected</p>
              <p className="text-[11px] mt-0.5">
                {configuredRouters.length} router{configuredRouters.length === 1 ? "" : "s"} actively streaming heartbeats.
              </p>
            </div>
          )}
        </div>

        <div className="border-t p-2 bg-muted/20 text-center">
          <Link
            to={isSuperAdmin ? "/super-admin/noc" : "/tenant/routers"}
            onClick={() => setOpen(false)}
            className="text-[11px] text-primary hover:underline font-medium inline-flex items-center gap-1"
          >
            <RouterIcon className="h-3 w-3" /> View all routers
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
