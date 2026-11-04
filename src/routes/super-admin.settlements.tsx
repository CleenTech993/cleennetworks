import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/super-admin/settlements")({ component: Commissions });

function Commissions() {
  const queryClient = useQueryClient();
  const [receipts, setReceipts] = useState<Record<string, string>>({});

  const { data: rows } = useQuery({
    queryKey: ["platform-commissions"],
    queryFn: async () => {
      const [{ data: commissions, error }, { data: tenants, error: tenantError }] =
        await Promise.all([
          supabase
            .from("platform_commissions")
            .select("*")
            .order("created_at", { ascending: false }),
          supabase.from("tenants").select("id,name,slug"),
        ]);
      if (error) throw error;
      if (tenantError) throw tenantError;
      const tenantMap = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant]));
      return (commissions ?? []).map((commission) => ({
        ...commission,
        tenant: tenantMap.get(commission.tenant_id) ?? { name: "Unknown tenant", slug: "" },
      }));
    },
  });

  const recordReceipt = useMutation({
    mutationFn: async (commissionId: string) => {
      const receipt = receipts[commissionId]?.trim().toUpperCase();
      if (!receipt) throw new Error("Enter the M-Pesa receipt number first.");
      const { error } = await supabase
        .from("platform_commissions")
        .update({
          status: "collected",
          mpesa_receipt: receipt,
          collected_at: new Date().toISOString(),
        })
        .eq("id", commissionId)
        .eq("status", "pending");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Commission receipt recorded");
      queryClient.invalidateQueries({ queryKey: ["platform-commissions"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div>
      <PageHeader
        title="Platform commissions and invoices"
        description="Review automatically issued monthly invoices and confirm tenant C2B settlements."
      />
      <div className="mb-6 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
        Invoices are generated automatically after each completed month from successful payments.
        Tenants have 72 hours after invoice issue to pay by C2B. Record a receipt only after
        independently confirming the payment.
      </div>

      {!rows?.length ? (
        <EmptyState
          title="No commission invoices yet"
          description="Invoices are generated automatically after each monthly billing period."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left">Tenant</th>
                <th className="px-4 py-2.5 text-left">Invoice</th>
                <th className="px-4 py-2.5 text-left">Period</th>
                <th className="px-4 py-2.5 text-left">Gross</th>
                <th className="px-4 py-2.5 text-left">Commission due</th>
                <th className="px-4 py-2.5 text-left">Due / email</th>
                <th className="px-4 py-2.5 text-left">Status / receipt</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-4 py-2.5">{row.tenant.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {row.invoice_number ?? "Legacy"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {new Date(row.period_start).toLocaleDateString("en-KE", {
                      timeZone: "Africa/Nairobi",
                    })}{" "}
                    –{" "}
                    {new Date(new Date(row.period_end).getTime() - 1000).toLocaleDateString(
                      "en-KE",
                      { timeZone: "Africa/Nairobi" },
                    )}
                  </td>
                  <td className="px-4 py-2.5">KES {Number(row.gross_amount).toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-medium">
                    KES {Number(row.commission_amount).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <p>
                      {row.due_at
                        ? new Date(row.due_at).toLocaleString("en-KE", {
                            timeZone: "Africa/Nairobi",
                          })
                        : "—"}
                    </p>
                    <p
                      className={
                        row.email_status === "failed" ? "text-destructive" : "text-muted-foreground"
                      }
                    >
                      Email: {row.email_status}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={row.status === "collected" ? "default" : "secondary"}>
                      {row.status}
                    </Badge>
                    {row.mpesa_receipt && (
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {row.mpesa_receipt}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {row.status === "pending" && (
                      <div className="flex justify-end gap-2">
                        <Input
                          aria-label={`M-Pesa receipt for ${row.tenant.name}`}
                          placeholder="C2B receipt"
                          value={receipts[row.id] ?? ""}
                          onChange={(event) =>
                            setReceipts({ ...receipts, [row.id]: event.target.value })
                          }
                          className="max-w-36"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => recordReceipt.mutate(row.id)}
                          disabled={recordReceipt.isPending}
                        >
                          Record
                        </Button>
                      </div>
                    )}
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
