import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/super-admin/billing")({ component: Billing });

function Billing() {
  const { data } = useQuery({
    queryKey: ["saas-billing"],
    queryFn: async () => {
      const { data: tenants } = await supabase.from("tenants").select("id,status,platform_commission_pct");
      const { data: payments } = await supabase.from("payments").select("tenant_id,amount").eq("status", "success");
      const gmv = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);

      const pctById = new Map<string, number>();
      for (const t of tenants ?? []) pctById.set(t.id, Number(t.platform_commission_pct ?? 5));
      const commission = (payments ?? []).reduce((s, p) => s + Number(p.amount) * (pctById.get(p.tenant_id) ?? 5) / 100, 0);

      const { data: settlements } = await supabase.from("settlements").select("status,net_amount");
      const owed = (settlements ?? []).filter((s) => s.status !== "paid").reduce((s, r) => s + Number(r.net_amount), 0);

      return {
        tenants: tenants?.length ?? 0,
        active: (tenants ?? []).filter((t) => t.status === "active").length,
        gmv,
        commission,
        owed,
      };
    },
  });

  return (
    <div>
      <PageHeader title="SaaS Billing" description="GMV across all tenants, platform commission earned, settlements outstanding." />
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Tenants" value={data?.tenants ?? "—"} hint={`${data?.active ?? 0} active`} />
        <StatCard label="GMV processed (KES)" value={data ? data.gmv.toLocaleString() : "—"} hint="All-time, successful" />
        <StatCard label="Platform commission (KES)" value={data ? Math.round(data.commission).toLocaleString() : "—"} hint="Earned across all tenants" />
        <StatCard label="Owed to tenants (KES)" value={data ? Math.round(data.owed).toLocaleString() : "—"} hint="Pending settlements" />
      </div>
      <div className="mt-6 rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Subscription plans</h3>
        <p className="mt-1 text-sm text-muted-foreground">Define monthly plans (Starter / Growth / Scale) and assign tenants. Auto-charge via M-Pesa on the 1st of every month — wiring coming with the billing job.</p>
      </div>
    </div>
  );
}
