import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/portal/invoices")({ component: Invoices });

function Invoices() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["portal-invoices", user?.email],
    enabled: !!user?.email,
    queryFn: async () => {
      const { data: customer } = await supabase.from("customers").select("id").eq("email", user!.email!).maybeSingle();
      if (!customer) return [];
      const { data } = await supabase
        .from("payments")
        .select("id,amount,status,mpesa_receipt,created_at")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div>
      <PageHeader title="Invoices" description="Your M-Pesa payment receipts." />
      {!data?.length ? (
        <EmptyState title="No invoices yet" description="Receipts appear here after your first successful M-Pesa payment." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">M-Pesa receipt</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2 text-muted-foreground">{new Date(p.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 font-medium">KES {Number(p.amount).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">{p.mpesa_receipt ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${p.status === "success" ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{p.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
