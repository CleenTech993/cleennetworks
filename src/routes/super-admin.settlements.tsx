import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmPlatformInvoiceReceipt } from "@/lib/platform-invoice.functions";
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

  const confirmReceipt = useMutation({
    mutationFn: async ({ commissionId, receipt }: { commissionId: string; receipt: string }) => {
      if (!receipt) throw new Error("Enter the M-Pesa receipt number first.");
      return confirmPlatformInvoiceReceipt({
        data: { invoiceId: commissionId, receipt },
      });
    },
    onSuccess: () => {
      toast.success("Payment code matched; invoice marked paid");
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
        Hotspot and voucher income is charged at 2%; PPPoE income is charged at 1%. Tenants have 72
        hours after invoice issue to pay. Verify each payment against the platform's M-Pesa records;
        the invoice is marked paid only when your code exactly matches the tenant-submitted code.
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
                <th className="px-4 py-2.5 text-left">Income breakdown</th>
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
                  <td className="px-4 py-2.5 text-xs">
                    {row.hotspot_gross_amount != null && row.pppoe_gross_amount != null ? (
                      <>
                        <p>
                          Hotspot / voucher: KES {Number(row.hotspot_gross_amount).toLocaleString()}
                        </p>
                        <p>PPPoE: KES {Number(row.pppoe_gross_amount).toLocaleString()}</p>
                        <p className="mt-1 font-medium">
                          Total: KES {Number(row.gross_amount).toLocaleString()}
                        </p>
                      </>
                    ) : (
                      <>KES {Number(row.gross_amount).toLocaleString()} (legacy)</>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    {row.hotspot_commission_amount != null &&
                    row.pppoe_commission_amount != null ? (
                      <div className="text-xs">
                        <p>
                          Hotspot 2%: KES {Number(row.hotspot_commission_amount).toLocaleString()}
                        </p>
                        <p>PPPoE 1%: KES {Number(row.pppoe_commission_amount).toLocaleString()}</p>
                        <p className="mt-1 font-semibold">
                          Total: KES {Number(row.commission_amount).toLocaleString()}
                        </p>
                      </div>
                    ) : (
                      <>KES {Number(row.commission_amount).toLocaleString()}</>
                    )}
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
                    {row.tenant_mpesa_receipt && row.status === "pending" && (
                      <p className="mt-1 text-xs">
                        Tenant submitted:{" "}
                        <span className="font-mono">{row.tenant_mpesa_receipt}</span>
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {row.status === "pending" && (
                      <div className="flex justify-end gap-2">
                        <Input
                          aria-label={`M-Pesa receipt for ${row.tenant.name}`}
                          placeholder="C2B receipt"
                          maxLength={40}
                          value={receipts[row.id] ?? ""}
                          onChange={(event) =>
                            setReceipts({ ...receipts, [row.id]: event.target.value })
                          }
                          className="max-w-36"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            confirmReceipt.mutate({
                              commissionId: row.id,
                              receipt: receipts[row.id]?.trim() ?? "",
                            })
                          }
                          disabled={confirmReceipt.isPending || !row.tenant_mpesa_receipt}
                        >
                          Match & pay
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
