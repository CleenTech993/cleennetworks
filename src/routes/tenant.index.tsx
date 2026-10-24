import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, CreditCard, Package, Router, Users } from "lucide-react";
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

  const steps = [
    { done: (data?.routerCount ?? 0) > 0, title: "Add your first router", body: "Generate the setup line and paste it into the MikroTik terminal.", to: "/tenant/routers", cta: "Add router" },
    { done: (data?.packages ?? 0) > 0, title: "Create a package", body: "Set the price and duration customers can buy.", to: "/tenant/packages", cta: "Create package" },
    { done: false, title: "Add your M-Pesa details", body: "Enter your paybill or till so customers can pay you.", to: "/tenant/settings", cta: "Open settings" },
  ];
  const remaining = steps.filter((s) => !s.done).length;

  return (
    <div>
      <PageHeader title="Overview" description="Where your network and revenue stand right now." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Router} label="Routers" value={data?.routerCount ?? "—"} hint={`${data?.online ?? 0} online`} />
        <StatCard icon={Users} label="Active customers" value={data?.activeCustomers ?? "—"} hint={`${data?.customers ?? 0} total`} />
        <StatCard icon={Package} label="Packages" value={data?.packages ?? "—"} />
        <StatCard icon={CreditCard} label="Revenue (KES)" value={data ? data.revenue.toLocaleString() : "—"} hint="All time" />
      </div>

      {data && remaining > 0 && (
        <section className="mt-8 rounded-xl border bg-card">
          <div className="border-b px-5 py-4">
            <h3 className="text-base font-semibold">Get your ISP running</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">Your captive portal goes live once a router reports back.</p>
          </div>
          <ul className="divide-y">
            {steps.map((s) => (
              <li key={s.title} className="flex items-center gap-4 px-5 py-4">
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${s.done ? "border-success bg-success text-success-foreground" : "border-input text-transparent"}`}
                  aria-label={s.done ? "Done" : "Not done"}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${s.done ? "text-muted-foreground line-through" : ""}`}>{s.title}</p>
                  <p className="text-sm text-muted-foreground">{s.body}</p>
                </div>
                {!s.done && (
                  <Link to={s.to} className="shrink-0 text-sm font-medium text-primary hover:underline">{s.cta}</Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
