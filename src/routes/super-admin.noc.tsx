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

type RouterRow = Tables<"routers"> & { tenantName?: string | null };

export const Route = createFileRoute("/super-admin/noc")({ component: NocPage });

function isOnline(r: RouterRow) {
  const last = r.last_heartbeat_at ?? r.last_seen_at;
  if (!last) return false;
  return Date.now() - new Date(last).getTime() < 3 * 60 * 1000;
}

function NocPage() {
  const { data, refetch } = useQuery({
    queryKey: ["noc-routers"],
    queryFn: async () => {
      const [routersRes, tenantsRes] = await Promise.all([
        supabase.from("routers").select("*").order("last_heartbeat_at", { ascending: false, nullsFirst: false }),
        supabase.from("tenants").select("id,name"),
      ]);
      if (routersRes.error) throw routersRes.error;
      if (tenantsRes.error) throw tenantsRes.error;
      const tmap = new Map((tenantsRes.data ?? []).map((t) => [t.id, t.name]));
      return (routersRes.data ?? []).map((r) => ({ ...r, tenantName: tmap.get(r.tenant_id) ?? null })) as RouterRow[];
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
        <StatCard label="Online" value={online} hint={`${routers.length ? Math.round((online / routers.length) * 100) : 0}%`} />
        <StatCard label="Offline" value={offline} />
        <StatCard label="Avg CPU" value={`${avgCpu}%`} />
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Router</th>
              <th className="px-4 py-3 text-left">Tenant</th>
              <th className="px-4 py-3 text-left">Status</th>
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
                  : r.ram_usage ?? null;
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
                    <Badge variant={live ? "default" : "secondary"}>{live ? "online" : "offline"}</Badge>
                  </td>
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
                    {r.last_heartbeat_at ?? r.last_seen_at
                      ? new Date((r.last_heartbeat_at ?? r.last_seen_at)!).toLocaleString()
                      : "never"}
                  </td>
                </tr>
              );
            })}
            {routers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
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
        <Link to="/super-admin/tenants" className="underline">Manage tenants</Link>
      </p>

      <WireGuardPanel routers={routers} />
    </div>
  );
}

function WireGuardPanel({ routers }: { routers: RouterRow[] }) {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({
    queryKey: ["wg-config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_wg_config").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [host, setHost] = useState("");
  const [port, setPort] = useState("51820");
  const [pubkey, setPubkey] = useState("");
  const [network, setNetwork] = useState("10.99.0.0/24");
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (cfg && !loaded) {
      setHost(cfg.server_host ?? "");
      setPort(String(cfg.server_port ?? 51820));
      setPubkey(cfg.server_public_key ?? "");
      setNetwork(cfg.tunnel_network ?? "10.99.0.0/24");
      setEnabled(cfg.enabled ?? false);
      setLoaded(true);
    }
  }, [cfg, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("platform_wg_config").update({
        server_host: host || null,
        server_port: parseInt(port, 10) || 51820,
        server_public_key: pubkey || null,
        tunnel_network: network || "10.99.0.0/24",
        enabled,
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("WireGuard endpoint saved");
      qc.invalidateQueries({ queryKey: ["wg-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const peers = routers.filter((r) => r.wg_public_key);

  return (
    <div className="mt-8 rounded-lg border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <div>
          <h3 className="font-semibold">WireGuard management tunnel</h3>
          <p className="text-xs text-muted-foreground">
            One platform endpoint. Routers register their key during provisioning and build an encrypted tunnel for management traffic.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <Label htmlFor="wg-host">Server address (public IP or DNS)</Label>
            <Input id="wg-host" className="mt-1" placeholder="vpn.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="wg-port">Port</Label>
              <Input id="wg-port" className="mt-1" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="wg-net">Tunnel network</Label>
              <Input id="wg-net" className="mt-1" value={network} onChange={(e) => setNetwork(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="wg-pub">Server public key</Label>
            <Input id="wg-pub" className="mt-1 font-mono text-xs" placeholder="base64 WireGuard public key" value={pubkey} onChange={(e) => setPubkey(e.target.value)} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="wg-enabled">Enable tunnel provisioning</Label>
            <Switch id="wg-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save endpoint"}
          </Button>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium">Registered router peers ({peers.length})</h4>
          {peers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No routers have registered a key yet. Save the endpoint, then re-run provisioning on each router.
            </p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {peers.map((r) => (
                <div key={r.id} className="rounded-md bg-muted p-2 text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">{r.name}</span>
                    <span className="font-mono">{r.wg_tunnel_ip?.split("/")[0]}</span>
                  </div>
                  <div className="mt-1 break-all font-mono text-muted-foreground">{r.wg_public_key}</div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Add each peer above to your WireGuard server config with its tunnel IP as the allowed address.
          </p>
        </div>
      </div>
    </div>
  );
}
