import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/super-admin/billing")({ component: Billing });

function Billing() {
  const { data } = useQuery({
    queryKey: ["saas-billing"],
    queryFn: async () => {
      const [
        { data: tenants, error: tenantError },
        { data: payments, error: paymentError },
        { data: invoices, error: invoiceError },
      ] = await Promise.all([
        supabase.from("tenants").select("id,status"),
        supabase.from("payments").select("tenant_id,amount").eq("status", "success"),
        supabase.from("platform_commissions").select("commission_amount,status"),
      ]);
      if (tenantError) throw tenantError;
      if (paymentError) throw paymentError;
      if (invoiceError) throw invoiceError;
      const gmv = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
      const commission = (invoices ?? []).reduce((s, row) => s + Number(row.commission_amount), 0);
      const owed = (invoices ?? [])
        .filter((row) => row.status === "pending")
        .reduce((s, row) => s + Number(row.commission_amount), 0);

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
      <PageHeader
        title="SaaS Billing"
        description="Monthly commission invoices, platform commission earned, and overdue balances."
      />
      <Button asChild className="mb-5">
        <Link to="/super-admin/settlements">Manage invoices and receipts</Link>
      </Button>
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Tenants"
          value={data?.tenants ?? "—"}
          hint={`${data?.active ?? 0} active`}
        />
        <StatCard
          label="GMV processed (KES)"
          value={data ? data.gmv.toLocaleString() : "—"}
          hint="All-time, successful"
        />
        <StatCard
          label="Commission invoiced (KES)"
          value={data ? Math.round(data.commission).toLocaleString() : "—"}
          hint="Total issued platform commissions"
        />
        <StatCard
          label="Outstanding commission (KES)"
          value={data ? Math.round(data.owed).toLocaleString() : "—"}
          hint="Unpaid invoices"
        />
      </div>
      <div className="mt-6 rounded-xl border bg-card p-6">
        <h3 className="font-semibold">Subscription plans</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Define monthly plans (Starter / Growth / Scale) and assign tenants. Auto-charge via M-Pesa
          on the 1st of every month — wiring coming with the billing job.
        </p>
      </div>
    </div>
  );
}
