import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const RANGES = {
  "24h": 24 * 3600e3,
  "7d": 7 * 24 * 3600e3,
  "30d": 30 * 24 * 3600e3,
  "12m": 365 * 24 * 3600e3,
} as const;
type RangeKey = keyof typeof RANGES;

export function uptimePct(
  events: { started_at: string; ended_at: string | null }[],
  windowMs: number,
  lastHeartbeat: string | null,
  firstSeen: string,
) {
  const now = Date.now();
  const start = Math.max(now - windowMs, new Date(firstSeen).getTime());
  const total = now - start;
  if (total <= 0) return null;
  let down = 0;
  for (const e of events) {
    const s = Math.max(new Date(e.started_at).getTime(), start);
    const en = Math.min(e.ended_at ? new Date(e.ended_at).getTime() : now, now);
    if (en > s) down += en - s;
  }
  // Ongoing outage (no heartbeat in >3 min) - unless an open downtime event already covers it
  const hasOpenEvent = events.some((e) => !e.ended_at);
  if (lastHeartbeat && !hasOpenEvent) {
    const lh = new Date(lastHeartbeat).getTime();
    if (now - lh > 3 * 60e3) down += now - Math.max(lh, start);
  }
  return Math.max(0, Math.min(100, ((total - down) / total) * 100));
}

export function RouterHistory({
  routerId,
  lastHeartbeat,
  createdAt,
}: {
  routerId: string;
  lastHeartbeat: string | null;
  createdAt: string;
}) {
  const [range, setRange] = useState<RangeKey>("24h");

  const { data: events = [] } = useQuery({
    queryKey: ["uptime-events", routerId],
    queryFn: async () => {
      const since = new Date(Date.now() - RANGES["12m"]).toISOString();
      const { data, error } = await supabase
        .from("router_uptime_events")
        .select("started_at,ended_at")
        .eq("router_id", routerId)
        .gte("started_at", since)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  const { data: series = [] } = useQuery({
    queryKey: ["router-metrics", routerId, range],
    queryFn: async () => {
      const since = new Date(Date.now() - RANGES[range]);
      if (range === "24h" || range === "7d") {
        const { data, error } = await supabase
          .from("router_metrics")
          .select("ts,cpu_pct,mem_pct,temp")
          .eq("router_id", routerId)
          .gte("ts", since.toISOString())
          .order("ts", { ascending: true })
          .limit(2000);
        if (error) throw error;
        return (data ?? []).map((m) => ({ t: m.ts, cpu: m.cpu_pct, mem: m.mem_pct }));
      }
      const { data, error } = await supabase
        .from("router_metrics_daily")
        .select("day,avg_cpu,avg_mem")
        .eq("router_id", routerId)
        .gte("day", since.toISOString().slice(0, 10))
        .order("day", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((d) => ({
        t: d.day,
        cpu: Number(d.avg_cpu),
        mem: Number(d.avg_mem),
      }));
    },
    refetchInterval: 60_000,
  });

  const fmt = (t: string) => {
    const d = new Date(t);
    return range === "24h"
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString();
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        {(Object.keys(RANGES) as RangeKey[]).map((k) => {
          const p = uptimePct(events, RANGES[k], lastHeartbeat, createdAt);
          return (
            <div key={k} className="rounded-xl border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground">Uptime {k}</div>
              <div className="mt-1 text-2xl font-semibold">
                {p == null ? "—" : `${p.toFixed(2)}%`}
              </div>
              <div className="text-xs text-muted-foreground">
                SLA {p != null && p >= 99.5 ? "met" : "below 99.5%"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">CPU &amp; memory</h3>
          <div className="flex gap-1">
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <Button
                key={k}
                size="sm"
                variant={range === k ? "default" : "outline"}
                onClick={() => setRange(k)}
              >
                {k}
              </Button>
            ))}
          </div>
        </div>
        {series.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No data for this period yet.
          </p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="t" tickFormatter={fmt} fontSize={11} minTickGap={40} />
                <YAxis domain={[0, 100]} fontSize={11} unit="%" />
                <Tooltip labelFormatter={(l) => new Date(l as string).toLocaleString()} />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  name="CPU"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.15}
                />
                <Area
                  type="monotone"
                  dataKey="mem"
                  name="Memory"
                  stroke="hsl(var(--chart-2, var(--accent-foreground)))"
                  fill="hsl(var(--chart-2, var(--accent-foreground)))"
                  fillOpacity={0.1}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h3 className="mb-3 font-semibold">Recent outages</h3>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outages recorded.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {events.slice(0, 10).map((e, i) => {
              const mins = Math.round(
                ((e.ended_at ? new Date(e.ended_at).getTime() : Date.now()) -
                  new Date(e.started_at).getTime()) /
                  60000,
              );
              return (
                <li key={i} className="flex justify-between">
                  <span>{new Date(e.started_at).toLocaleString()}</span>
                  <span className="text-muted-foreground">{mins} min down</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
