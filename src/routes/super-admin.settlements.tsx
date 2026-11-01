import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/super-admin/settlements")({ component: Commissions });

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function endOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

function Commissions() {
  const queryClient = useQueryClient();
  const [start, setStart] = useState(startOfMonth());
  const [end, setEnd] = useState(endOfMonth());
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

  const generate = useMutation({
    mutationFn: async () => {
      const periodStart = new Date(start).toISOString();
      const periodEnd = new Date(`${end}T23:59:59`).toISOString();
      if (periodEnd < periodStart) throw new Error("End date must be on or after start date.");

      const { data: existing, error: existingError } = await supabase
        .from("platform_commissions")
        .select("id")
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd)
        .limit(1);
      if (existingError) throw existingError;
      if (existing?.length) throw new Error("A commission run already exists for this period.");

      const [{ data: tenants, error: tenantError }, { data: payments, error: paymentError }] =
        await Promise.all([
          supabase.from("tenants").select("id,name,platform_commission_pct"),
          supabase
            .from("payments")
            .select("tenant_id,amount")
            .eq("status", "success")
            .gte("created_at", periodStart)
            .lte("created_at", periodEnd),
        ]);
      if (tenantError) throw tenantError;
      if (paymentError) throw paymentError;

      const grossByTenant = new Map<string, number>();
      for (const payment of payments ?? []) {
        grossByTenant.set(
          payment.tenant_id,
          (grossByTenant.get(payment.tenant_id) ?? 0) + Number(payment.amount),
        );
      }

      const commissions = (tenants ?? []).flatMap((tenant) => {
        const gross = grossByTenant.get(tenant.id) ?? 0;
        if (gross <= 0) return [];
        const commissionPct = Number(tenant.platform_commission_pct ?? 5);
        return [
          {
            tenant_id: tenant.id,
            period_start: periodStart,
            period_end: periodEnd,
            gross_amount: gross,
            commission_amount: Math.round(gross * (commissionPct / 100) * 100) / 100,
            status: "pending",
          },
        ];
      });
      if (commissions.length === 0) throw new Error("No successful payments in that period.");
      const { error } = await supabase.from("platform_commissions").insert(commissions);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Commission run created");
      queryClient.invalidateQueries({ queryKey: ["platform-commissions"] });
    },
    onError: (error: Error) => toast.error(error.message),
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
        title="Platform commissions"
        description="Tenants collect their customer payments directly. This ledger tracks commission owed to the platform and C2B receipts sent by tenants."
      />
      <div className="mb-6 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
        Generating a run records commission due; it does not move money. The tenant must send a
        separate C2B payment to the platform PayBill/Till. Record its M-Pesa receipt only after
        confirming the payment.
      </div>
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div>
          <Label htmlFor="commission-start">Period start</Label>
          <Input
            id="commission-start"
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="commission-end">Period end</Label>
          <Input
            id="commission-end"
            type="date"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            className="mt-1"
          />
        </div>
        <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
          Generate commission run
        </Button>
      </div>

      {!rows?.length ? (
        <EmptyState
          title="No commission runs yet"
          description="Generate a run for a payment period."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left">Tenant</th>
                <th className="px-4 py-2.5 text-left">Period</th>
                <th className="px-4 py-2.5 text-left">Gross</th>
                <th className="px-4 py-2.5 text-left">Commission due</th>
                <th className="px-4 py-2.5 text-left">Status / receipt</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-4 py-2.5">{row.tenant.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {new Date(row.period_start).toLocaleDateString()} –{" "}
                    {new Date(row.period_end).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5">KES {Number(row.gross_amount).toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-medium">
                    KES {Number(row.commission_amount).toLocaleString()}
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
