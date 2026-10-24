import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";
import { healthScore, isRouterLive } from "@/lib/router-health";

export const Route = createFileRoute("/super-admin/health")({ component: Health });

function Health() {
  const { data } = useQuery({
    queryKey: ["platform-health"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [routers, payments] = await Promise.all([
        supabase.from("routers").select("*"),
        supabase.from("payments").select("status,created_at").gte("created_at", since),
      ]);
      const live = (routers.data ?? []).filter((r) => isRouterLive(r));
      const online = live.length;
      const avgHealth = live.length ? Math.round(live.reduce((s, r) => s + healthScore(r), 0) / live.length) : 0;
      const total = routers.data?.length ?? 0;
      const success = (payments.data ?? []).filter((p) => p.status === "success").length;
      const totalPay = payments.data?.length ?? 0;
      return {
        online,
        total,
        avgHealth,
        uptimePct: total ? Math.round((online / total) * 100) : 0,
        success,
        totalPay,
        callbackPct: totalPay ? Math.round((success / totalPay) * 100) : 0,
      };
    },
  });

  return (
    <div>
      <PageHeader title="Platform Health" description="Router uptime, M-Pesa callback success and queue depth." />
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Routers online" value={data ? `${data.online}/${data.total}` : "—"} hint={data ? `${data.uptimePct}% live` : undefined} />
        <StatCard label="Avg router health" value={data ? `${data.avgHealth}%` : "—"} hint="Online routers only" />
        <StatCard label="M-Pesa success (24h)" value={data ? `${data.success}/${data.totalPay}` : "—"} hint={data ? `${data.callbackPct}%` : undefined} />
        <StatCard label="Job queue depth" value="0" hint="In-memory placeholder" />
      </div>
    </div>
  );
}
