import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tenant/payments")({ component: Payments });

function Payments() {
  const { data, isLoading } = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });
  return (
    <div>
      <PageHeader title="Payments" description="M-Pesa transactions and reconciliation." />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : !data?.length ? <EmptyState title="No payments yet" description="Once M-Pesa callbacks arrive, transactions appear here." />
        : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr><th className="px-4 py-2.5 text-left">Date</th><th className="px-4 py-2.5 text-left">Phone</th><th className="px-4 py-2.5 text-left">Amount</th><th className="px-4 py-2.5 text-left">Receipt</th><th className="px-4 py-2.5 text-left">Status</th></tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-4 py-2.5">{new Date(p.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2.5">{p.phone ?? "—"}</td>
                    <td className="px-4 py-2.5">KES {Number(p.amount).toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{p.mpesa_receipt ?? "—"}</td>
                    <td className="px-4 py-2.5"><Badge variant={p.status === "success" ? "default" : p.status === "failed" ? "destructive" : "secondary"}>{p.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
