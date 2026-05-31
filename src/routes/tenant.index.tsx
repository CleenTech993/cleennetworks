import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tenant/")({ component: Overview });

function Overview() {
  const { data } = useQuery({
    queryKey: ["tenant-overview"],
    queryFn: async () => {
      const [routers, customers, packages, payments] = await Promise.all([
        supabase.from("routers").select("id,status", { count: "exact", head: false }),
        supabase.from("customers").select("id,status", { count: "exact", head: false }),
        supabase.from("packages").select("id", { count: "exact", head: true }),
        supabase.from("payments").select("amount,status,created_at").eq("status", "success"),
      ]);
      const revenue = (payments.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
      const online = (routers.data ?? []).filter((r) => r.status === "online").length;
      const activeCustomers = (customers.data ?? []).filter((c) => c.status === "active").length;
      return {
        routerCount: routers.data?.length ?? 0,
        online,
        customers: customers.data?.length ?? 0,
        activeCustomers,
        packages: packages.count ?? 0,
        revenue,
      };
    },
  });

  return (
    <div>
      <PageHeader title="Overview" description="Snapshot of your ISP operations." />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Routers" value={data?.routerCount ?? "—"} hint={`${data?.online ?? 0} online`} />
        <StatCard label="Active customers" value={data?.activeCustomers ?? "—"} hint={`${data?.customers ?? 0} total`} />
        <StatCard label="Packages" value={data?.packages ?? "—"} />
        <StatCard label="Revenue (KES)" value={data ? data.revenue.toLocaleString() : "—"} hint="Lifetime" />
      </div>
      <div className="mt-6 rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Welcome to NetGrid</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Start by adding a MikroTik router, defining hotspot packages and configuring your M-Pesa
          shortcode in Settings. Your captive portal will be live as soon as a router reports back.
        </p>
      </div>
    </div>
  );
}
