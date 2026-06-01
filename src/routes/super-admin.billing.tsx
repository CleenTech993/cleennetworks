import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/super-admin/billing")({ component: Billing });

function Billing() {
  const { data } = useQuery({
    queryKey: ["saas-billing"],
    queryFn: async () => {
      const { data: tenants } = await supabase.from("tenants").select("id,status");
      const { data: payments } = await supabase.from("payments").select("amount").eq("status", "success");
      const gmv = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
      return {
        tenants: tenants?.length ?? 0,
        active: (tenants ?? []).filter((t) => t.status === "active").length,
        gmv,
      };
    },
  });

  return (
    <div>
      <PageHeader title="SaaS Billing" description="Tenant subscriptions, invoices and plan changes." />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Tenants" value={data?.tenants ?? "—"} hint={`${data?.active ?? 0} active`} />
        <StatCard label="GMV processed (KES)" value={data ? data.gmv.toLocaleString() : "—"} hint="Across all tenants" />
        <StatCard label="Platform fee (5%)" value={data ? Math.round(data.gmv * 0.05).toLocaleString() : "—"} hint="Indicative" />
      </div>
      <div className="mt-6 rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Subscription plans</h3>
        <p className="mt-1 text-sm text-muted-foreground">Define monthly plans (Starter / Growth / Scale) and assign tenants. Auto-charge via M-Pesa on the 1st of every month — wiring coming with the billing job.</p>
      </div>
    </div>
  );
}
