import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Cpu, HardDrive, Router as RouterIcon, ShieldCheck, Wifi } from "lucide-react";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { healthScore, isRouterLive } from "@/lib/router-health";

type RouterRow = Tables<"routers"> & { tenantName?: string | null };

export const Route = createFileRoute("/super-admin/noc")({ component: NocPage });

const isOnline = (r: RouterRow) => isRouterLive(r);

function NocPage() {
  const { data, refetch } = useQuery({
    queryKey: ["noc-routers"],
    queryFn: async () => {
      const [routersRes, tenantsRes] = await Promise.all([
        supabase
          .from("routers")
          .select("*")
          .order("last_heartbeat_at", { ascending: false, nullsFirst: false }),
        supabase.from("tenants").select("id,name"),
      ]);
      if (routersRes.error) throw routersRes.error;
      if (tenantsRes.error) throw tenantsRes.error;
      const tmap = new Map((tenantsRes.data ?? []).map((t) => [t.id, t.name]));
      return (routersRes.data ?? []).map((r) => ({
        ...r,
        tenantName: tmap.get(r.tenant_id) ?? null,
      })) as RouterRow[];
    },
    refetchInterval: 30_000,
  });

  // Live updates via Supabase Realtime
  useEffect(() => {
    const ch = supabase
      .channel("noc-routers")
      .on("postgres_changes", { event: "*", schema: "public", table: "routers" }, () => {
        refetch();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [refetch]);

  // Tick every 20s so "online" badges recompute against last_heartbeat_at
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 20_000);
    return () => clearInterval(i);
  }, []);

  const routers = data ?? [];
  const online = routers.filter(isOnline).length;
  const offline = routers.length - online;
  const avgCpu =
    routers.length === 0
      ? 0
      : Math.round(
          routers.reduce((s, r) => s + (r.cpu_load ?? r.cpu_usage ?? 0), 0) / routers.length,
        );

  return (
    <div>
      <PageHeader
        title="Network Operations Center"
        description="Live status across every router on the platform."
      />
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <StatCard label="Total routers" value={routers.length} />
        <StatCard
          label="Online"
          value={online}
          hint={`${routers.length ? Math.round((online / routers.length) * 100) : 0}%`}
        />
        <StatCard label="Offline" value={offline} />
        <StatCard label="Avg CPU" value={`${avgCpu}%`} />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Router</th>
              <th className="px-4 py-3 text-left">Tenant</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Health</th>
              <th className="px-4 py-3 text-left">CPU</th>
              <th className="px-4 py-3 text-left">RAM</th>
              <th className="px-4 py-3 text-left">WAN IP</th>
              <th className="px-4 py-3 text-left">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {routers.map((r) => {
              const live = isOnline(r);
              const ramPct =
                r.total_memory_mb && r.free_memory_mb != null
                  ? Math.round(((r.total_memory_mb - r.free_memory_mb) / r.total_memory_mb) * 100)
                  : (r.ram_usage ?? null);
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
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
                  <td className="px-4 py-3 text-muted-foreground">{r.tenantName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant={live ? "default" : "secondary"}>
                      {live ? "online" : "offline"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{live ? `${healthScore(r)}%` : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                      {r.cpu_load ?? r.cpu_usage ?? "—"}
                      {(r.cpu_load ?? r.cpu_usage) != null && "%"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
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
                </tr>
              );
            })}
            {routers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  <Wifi className="mx-auto mb-2 h-6 w-6 opacity-40" />
                  No routers provisioned yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        <Activity className="mr-1 inline h-3 w-3" />
        Live — updates push automatically on each router heartbeat.{" "}
        <Link to="/super-admin/tenants" className="underline">
          Manage tenants
        </Link>
      </p>
    </div>
  );
}
