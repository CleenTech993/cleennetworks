import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, CreditCard, Router, Users } from "lucide-react";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/super-admin/")({ component: Overview });
function Overview() {
  const { data } = useQuery({
    queryKey: ["super-overview"],
    queryFn: async () => {
      const [t, r, c, p] = await Promise.all([
        supabase.from("tenants").select("id", { count: "exact", head: true }),
        supabase.from("routers").select("id", { count: "exact", head: true }),
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("payments").select("amount").eq("status", "success"),
      ]);
      return {
        tenants: t.count ?? 0,
        routers: r.count ?? 0,
        customers: c.count ?? 0,
        gmv: (p.data ?? []).reduce((s, x) => s + Number(x.amount), 0),
      };
    },
  });
  return (
    <div>
      <PageHeader title="Platform overview" description="Totals across every tenant." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Building2} label="Tenants" value={data?.tenants ?? "—"} />
        <StatCard icon={Router} label="Routers" value={data?.routers ?? "—"} />
        <StatCard icon={Users} label="Customers" value={data?.customers ?? "—"} />
        <StatCard
          icon={CreditCard}
          label="Payments processed (KES)"
          value={data ? data.gmv.toLocaleString() : "—"}
        />
      </div>
    </div>
  );
}
