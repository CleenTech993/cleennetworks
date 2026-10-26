import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, StatCard, EmptyState } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/portal/")({ component: PortalHome });

function PortalHome() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["portal-me", user?.email],
    enabled: !!user?.email,
    queryFn: async () => {
      const { data: customer } = await supabase
        .from("customers")
        .select("id,full_name,status,expires_at,package_id")
        .eq("email", user!.email!)
        .maybeSingle();
      if (!customer?.package_id) return { customer, pkg: null };
      const { data: pkg } = await supabase
        .from("packages")
        .select("name,price,download_kbps,upload_kbps,data_limit_mb,unlimited")
        .eq("id", customer.package_id)
        .maybeSingle();
      return { customer, pkg };
    },
  });

  if (!data?.customer) {
    return (
      <div>
        <PageHeader title="My account" description="Your active package and renewal." />
        <EmptyState
          title="No subscription found"
          description="We couldn't find a subscription under your email. Buy a package to get online."
        />
      </div>
    );
  }

  const { customer, pkg } = data;
  return (
    <div>
      <PageHeader
        title={`Hi ${customer.full_name ?? "there"}`}
        description="Your active package and renewal."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Active package"
          value={pkg?.name ?? "—"}
          hint={pkg ? `KES ${Number(pkg.price).toLocaleString()}` : undefined}
        />
        <StatCard
          label="Speed"
          value={pkg ? `${pkg.download_kbps ?? "—"}/${pkg.upload_kbps ?? "—"} kbps` : "—"}
          hint="Down / Up"
        />
        <StatCard
          label="Expires"
          value={customer.expires_at ? new Date(customer.expires_at).toLocaleDateString() : "—"}
          hint={customer.status}
        />
      </div>
    </div>
  );
}
