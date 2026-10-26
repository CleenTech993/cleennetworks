import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tenant/payments")({
  head: () => ({
    meta: [
      { title: "Payments — Tenant console" },
      { name: "description", content: "M-Pesa transactions with transaction codes." },
    ],
  }),
  component: Payments,
});

function Payments() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data ?? [];
    return (data ?? []).filter((p) =>
      [p.phone, p.mpesa_receipt, p.voucher_code].some((v) => v?.toLowerCase().includes(s)),
    );
  }, [q, data]);
  return (
    <div>
      <PageHeader title="Payments" description="M-Pesa transactions and reconciliation." />
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search M-Pesa code, phone or voucher"
        />
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !rows.length ? (
        <EmptyState
          title="No payments"
          description={
            q
              ? "No payment matches your search."
              : "Once M-Pesa payments arrive, transactions appear here."
          }
        />
      ) : (
        <div className="rounded-xl border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left">Date</th>
                <th className="px-4 py-2.5 text-left">Phone</th>
                <th className="px-4 py-2.5 text-left">Amount</th>
                <th className="px-4 py-2.5 text-left">M-Pesa code</th>
                <th className="px-4 py-2.5 text-left">Voucher</th>
                <th className="px-4 py-2.5 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2.5">{new Date(p.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2.5">{p.phone ?? "—"}</td>
                  <td className="px-4 py-2.5">KES {Number(p.amount).toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold">
                    {p.mpesa_receipt ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{p.voucher_code ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge
                      variant={
                        p.status === "success"
                          ? "default"
                          : p.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {p.status}
                    </Badge>
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
