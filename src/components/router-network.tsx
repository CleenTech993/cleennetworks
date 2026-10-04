import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard-shell";

export function fmtBps(v?: number | null) {
  const n = Number(v ?? 0);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} Mbps`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} Kbps`;
  return `${n} bps`;
}
function fmtBytes(v?: number | null) {
  const n = Number(v ?? 0);
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, x = n;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(i ? 1 : 0)} ${u[i]}`;
}
const t = (s: string) => new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function useInterfaces(routerId: string) {
  const q = useQuery({
    queryKey: ["router-ifaces", routerId],
    queryFn: async () => {
      const { data, error } = await supabase.from("router_interfaces").select("*").eq("router_id", routerId).order("name");
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });
  useEffect(() => {
    const ch = supabase
      .channel(`ifaces-${routerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "router_interfaces", filter: `router_id=eq.${routerId}` }, () => q.refetch())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [routerId]); // eslint-disable-line react-hooks/exhaustive-deps
  return q;
}

function useMetrics(routerId: string) {
  return useQuery({
    queryKey: ["router-metrics-6h", routerId],
    queryFn: async () => {
      const since = new Date(Date.now() - 6 * 3600e3).toISOString();
      const { data, error } = await supabase
        .from("router_metrics")
        .select("ts,wan_latency_ms,wan_loss_pct,wan_jitter_ms,dns_ok,rx_bps,tx_bps")
        .eq("router_id", routerId)
        .gte("ts", since)
        .order("ts");
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });
}

const empty = (msg: string) => <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{msg}</p>;

export function InterfacesTab({ routerId }: { routerId: string }) {
  const { data } = useInterfaces(routerId);
  if (!data?.length) return empty("No port data yet. It appears within 2 minutes after the router runs the latest setup file.");
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>{["Port", "Status", "Download", "Upload", "Total in", "Total out", "Errors", "Drops"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((i) => (
            <tr key={i.id} className="border-t">
              <td className="px-3 py-2 font-mono text-xs">{i.name}</td>
              <td className="px-3 py-2">
                <Badge variant={i.disabled ? "outline" : i.running ? "default" : "secondary"}>{i.disabled ? "disabled" : i.running ? "up" : "down"}</Badge>
              </td>
              <td className="px-3 py-2">{fmtBps(i.rx_bps)}</td>
              <td className="px-3 py-2">{fmtBps(i.tx_bps)}</td>
              <td className="px-3 py-2">{fmtBytes(i.rx_bytes)}</td>
              <td className="px-3 py-2">{fmtBytes(i.tx_bytes)}</td>
              <td className="px-3 py-2">{i.rx_errors + i.tx_errors}</td>
              <td className="px-3 py-2">{i.rx_drops + i.tx_drops}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QualityTab({ routerId }: { routerId: string }) {
  const { data } = useMetrics(routerId);
  const pts = (data ?? []).filter((m) => m.wan_latency_ms != null);
  if (!pts.length) return empty("No internet quality samples yet.");
  const last = pts[pts.length - 1];
  const rows = pts.map((m) => ({ t: t(m.ts), latency: Number(m.wan_latency_ms), jitter: Number(m.wan_jitter_ms ?? 0), loss: Number(m.wan_loss_pct ?? 0) }));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Ping (8.8.8.8)" value={`${Number(last.wan_latency_ms).toFixed(0)} ms`} />
        <StatCard label="Jitter" value={`${Number(last.wan_jitter_ms ?? 0).toFixed(0)} ms`} />
        <StatCard label="Packet loss" value={`${Number(last.wan_loss_pct ?? 0).toFixed(0)}%`} />
        <StatCard label="DNS" value={last.dns_ok ? "Working" : "Failing"} />
      </div>
      <div className="rounded-lg border bg-card p-4">
        <h4 className="mb-2 text-sm font-medium">Last 6 hours</h4>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="t" fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip />
            <Line type="monotone" dataKey="latency" name="Ping ms" stroke="var(--primary)" dot={false} />
            <Line type="monotone" dataKey="jitter" name="Jitter ms" stroke="var(--muted-foreground)" dot={false} />
            <Line type="monotone" dataKey="loss" name="Loss %" stroke="var(--destructive)" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function TrafficTab({ routerId }: { routerId: string }) {
  const { data } = useMetrics(routerId);
  const { data: ifaces } = useInterfaces(routerId);
  const rows = (data ?? []).filter((m) => m.rx_bps != null).map((m) => ({ t: t(m.ts), down: Number(m.rx_bps) / 1e6, up: Number(m.tx_bps ?? 0) / 1e6 }));
  const top = [...(ifaces ?? [])].sort((a, b) => b.rx_bps + b.tx_bps - (a.rx_bps + a.tx_bps)).slice(0, 5);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <h4 className="mb-2 text-sm font-medium">Internet (ether1) speed, last 6 hours — Mbps</h4>
        {rows.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="t" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v: number) => `${v.toFixed(2)} Mbps`} />
              <Area type="monotone" dataKey="down" name="Download" stroke="var(--primary)" fill="color-mix(in oklab, var(--primary) 25%, transparent)" />
              <Area type="monotone" dataKey="up" name="Upload" stroke="var(--muted-foreground)" fill="color-mix(in oklab, var(--muted-foreground) 20%, transparent)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : <p className="text-sm text-muted-foreground">No traffic samples yet.</p>}
      </div>
      <div className="rounded-lg border bg-card p-4">
        <h4 className="mb-2 text-sm font-medium">Busiest ports right now</h4>
        {top.length ? top.map((i) => (
          <div key={i.id} className="flex justify-between border-t py-2 text-sm first:border-t-0">
            <span className="font-mono text-xs">{i.name}</span>
            <span>↓ {fmtBps(i.rx_bps)} · ↑ {fmtBps(i.tx_bps)}</span>
          </div>
        )) : <p className="text-sm text-muted-foreground">No port data yet.</p>}
      </div>
    </div>
  );
}
