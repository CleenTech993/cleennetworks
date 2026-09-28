import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Cpu, HardDrive, Thermometer, Zap } from "lucide-react";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { RouterHistory } from "@/components/router-history";

export const Route = createFileRoute("/tenant/routers/$id")({ component: RouterDetail });

function fmtUptime(sec?: number | null) {
  if (!sec) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function RouterDetail() {
  const { id } = useParams({ from: "/tenant/routers/$id" });
  const { data: r, refetch } = useQuery({
    queryKey: ["router", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("routers").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Tables<"routers"> | null;
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel(`router-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "routers", filter: `id=eq.${id}` },
        () => refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [id, refetch]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 20_000);
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
  const ramPct =
    r.total_memory_mb && r.free_memory_mb != null
      ? Math.round(((r.total_memory_mb - r.free_memory_mb) / r.total_memory_mb) * 100)
      : r.ram_usage ?? null;

  return (
    <div>
      <Link
        to="/tenant/routers"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All routers
      </Link>
      <PageHeader
        title={r.name}
        description={`${r.board_name ?? r.model ?? "Router"} · RouterOS ${r.routeros_version ?? "?"} · ${r.architecture ?? ""}`}
        action={<Badge variant={live ? "default" : "secondary"}>{live ? "online" : "offline"}</Badge>}
      />

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <StatCard
          label="CPU"
          value={r.cpu_load != null || r.cpu_usage != null ? `${r.cpu_load ?? r.cpu_usage}%` : "—"}
        />
        <StatCard label="RAM" value={ramPct != null ? `${ramPct}%` : "—"} hint={r.total_memory_mb ? `${r.total_memory_mb} MB total` : undefined} />
        <StatCard label="Disk free" value={r.hdd_free_mb != null ? `${r.hdd_free_mb} MB` : "—"} />
        <StatCard label="Uptime" value={fmtUptime(r.uptime_seconds ?? null)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          <h3 className="mb-3 font-semibold">Identity</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Model" value={r.model ?? r.board_name ?? "—"} />
            <Row label="Serial" value={r.serial ?? "—"} />
            <Row label="RouterOS" value={r.routeros_version ?? "—"} />
            <Row label="Architecture" value={r.architecture ?? "—"} />
            <Row label="MAC" value={r.mac_address ?? "—"} mono />
          </dl>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <h3 className="mb-3 font-semibold">Network &amp; health</h3>
          <dl className="space-y-2 text-sm">
            <Row label="WAN IP" value={r.wan_ip ?? r.public_ip ?? "—"} mono />
            <Row label="LAN IP" value={r.lan_ip ?? "—"} mono />
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
            <Row label="Last heartbeat" value={last ? new Date(last).toLocaleString() : "never"} />
          </dl>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Gauge label="CPU load" value={r.cpu_load ?? r.cpu_usage ?? null} icon={<Cpu className="h-4 w-4" />} />
        <Gauge label="Memory" value={ramPct} icon={<HardDrive className="h-4 w-4" />} />
      </div>

      <RouterHistory routerId={r.id} lastHeartbeat={last} createdAt={r.created_at} />
    </div>
  );
}

function Row({ label, value, mono, icon }: { label: string; value: string | number; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className={mono ? "font-mono text-xs" : ""}>{value}</dd>
    </div>
  );
}

function Gauge({ label, value, icon }: { label: string; value: number | null; icon: React.ReactNode }) {
  const pct = value ?? 0;
  const color = pct > 80 ? "bg-destructive" : pct > 60 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="rounded-lg border bg-card p-5">
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
