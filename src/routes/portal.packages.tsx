import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/portal/packages")({ component: BuyPackages });

function BuyPackages() {
  const { tenantId } = useAuth();
  const { data } = useQuery({
    queryKey: ["portal-packages", tenantId],
    queryFn: async () => {
      const q = supabase.from("packages").select("*").eq("active", true).order("price");
      const { data } = tenantId ? await q.eq("tenant_id", tenantId) : await q;
      return data ?? [];
    },
  });

  return (
    <div>
      <PageHeader title="Buy package" description="Select a plan and pay via M-Pesa STK Push." />
      {!data?.length ? (
        <EmptyState title="No packages available" description="Your ISP hasn't published any plans yet." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <div key={p.id} className="flex flex-col rounded-xl border bg-card p-5">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{p.kind}</div>
              <h3 className="mt-1 text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.description ?? ""}</p>
              <div className="mt-3 text-2xl font-bold">KES {Number(p.price).toLocaleString()}</div>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                <li>Speed: {p.download_kbps ?? "—"}/{p.upload_kbps ?? "—"} kbps</li>
                <li>Data: {p.unlimited ? "Unlimited" : p.data_limit_mb ? `${p.data_limit_mb} MB` : "—"}</li>
                <li>Duration: {p.duration_value ?? "—"} {p.duration_unit ?? ""}</li>
              </ul>
              <Button className="mt-4" disabled>Pay with M-Pesa (soon)</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
