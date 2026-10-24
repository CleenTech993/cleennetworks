import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/super-admin/settlements")({ component: Settlements });

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function endOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

function Settlements() {
  const qc = useQueryClient();
  const [start, setStart] = useState(startOfMonth());
  const [end, setEnd] = useState(endOfMonth());

  const { data: rows } = useQuery({
    queryKey: ["settlements"],
    queryFn: async () => {
      const [{ data: s, error }, { data: ts }] = await Promise.all([
        supabase.from("settlements").select("*").order("created_at", { ascending: false }),
        supabase.from("tenants").select("id,name,slug"),
      ]);
      if (error) throw error;
      const tmap = new Map((ts ?? []).map((t) => [t.id, t]));
      return (s ?? []).map((r) => ({
        ...r,
        tenant: tmap.get(r.tenant_id) ?? { name: "—", slug: "" },
      }));
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const periodStart = new Date(start).toISOString();
      const periodEnd = new Date(end + "T23:59:59").toISOString();

      const { data: tenants, error: tErr } = await supabase.from("tenants").select("id,name,platform_commission_pct");
      if (tErr) throw tErr;

      const { data: pays, error: pErr } = await supabase
        .from("payments")
        .select("tenant_id,amount")
        .eq("status", "success")
        .gte("created_at", periodStart)
        .lte("created_at", periodEnd);
      if (pErr) throw pErr;

      const totals = new Map<string, number>();
      for (const p of pays ?? []) {
        totals.set(p.tenant_id, (totals.get(p.tenant_id) ?? 0) + Number(p.amount));
      }

      const inserts: Array<{
        tenant_id: string; period_start: string; period_end: string;
        gross_amount: number; commission_amount: number; net_amount: number;
        payment_method: string; status: string;
      }> = [];
      for (const t of tenants ?? []) {
        const gross = totals.get(t.id) ?? 0;
        if (gross <= 0) continue;
        const pct = Number(t.platform_commission_pct ?? 5);
        const commission = Math.round(gross * (pct / 100) * 100) / 100;
        inserts.push({
          tenant_id: t.id,
          period_start: periodStart,
          period_end: periodEnd,
          gross_amount: gross,
          commission_amount: commission,
          net_amount: gross - commission,
          payment_method: "mpesa",
          status: "pending",
        });
      }
      if (inserts.length === 0) throw new Error("No successful payments in that period");
      const { error: iErr } = await supabase.from("settlements").insert(inserts);
      if (iErr) throw iErr;
    },
    onSuccess: () => { toast.success("Settlements generated"); qc.invalidateQueries({ queryKey: ["settlements"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const markPaid = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("settlements")
        .update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settlements"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="Settlements" description="Per-tenant payout records — what tenants are owed after platform commission." />
      <div className="rounded-xl border bg-card p-4 mb-6 flex flex-wrap items-end gap-3">
        <div><Label>Period start</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1" /></div>
        <div><Label>Period end</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1" /></div>
        <Button onClick={() => generate.mutate()} disabled={generate.isPending}>Generate for period</Button>
      </div>

      {!rows?.length ? (
        <EmptyState title="No settlements yet" description="Generate a settlement run for a period to see tenant payouts." />
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left">Tenant</th>
                <th className="px-4 py-2.5 text-left">Period</th>
                <th className="px-4 py-2.5 text-left">Gross</th>
                <th className="px-4 py-2.5 text-left">Commission</th>
                <th className="px-4 py-2.5 text-left">Net</th>
                <th className="px-4 py-2.5 text-left">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2.5">{r.tenant.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {new Date(r.period_start).toLocaleDateString()} → {new Date(r.period_end).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5">KES {Number(r.gross_amount).toLocaleString()}</td>
                  <td className="px-4 py-2.5">KES {Number(r.commission_amount).toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-medium">KES {Number(r.net_amount).toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={r.status === "paid" ? "default" : "secondary"}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {r.status !== "paid" && (
                      <Button size="sm" variant="outline" onClick={() => markPaid.mutate(r.id)}>Mark paid</Button>
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
