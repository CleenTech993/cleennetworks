import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  getPlatformC2bStatus,
  registerPlatformC2bCallbacks,
} from "@/lib/platform-invoice.functions";

export const Route = createFileRoute("/super-admin/payments")({ component: PlatformPayments });

function PlatformPayments() {
  const queryClient = useQueryClient();
  const [shortcode, setShortcode] = useState("");
  const { data: config, isLoading } = useQuery({
    queryKey: ["platform-c2b"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_mpesa_config")
        .select("shortcode")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: callbackStatus } = useQuery({
    queryKey: ["platform-c2b-callback-status"],
    queryFn: getPlatformC2bStatus,
  });
  const { data: transactions } = useQuery({
    queryKey: ["platform-c2b-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_mpesa_transactions")
        .select(
          "id,transaction_id,shortcode,bill_ref_number,amount,transaction_time,commission_id,status",
        )
        .order("transaction_time", { ascending: false })
        .limit(50);
      if (error) throw error;
      const commissionIds = (data ?? []).flatMap((transaction) =>
        transaction.commission_id ? [transaction.commission_id] : [],
      );
      if (!commissionIds.length) return [];
      const { data: invoices, error: invoiceError } = await supabase
        .from("platform_commissions")
        .select("id,invoice_number")
        .in("id", commissionIds);
      if (invoiceError) throw invoiceError;
      const invoiceNumbers = new Map(
        (invoices ?? []).map((invoice) => [invoice.id, invoice.invoice_number]),
      );
      return (data ?? []).map((transaction) => ({
        ...transaction,
        invoiceNumber: transaction.commission_id
          ? (invoiceNumbers.get(transaction.commission_id) ?? null)
          : null,
      }));
    },
    refetchInterval: 10_000,
  });

  useEffect(() => setShortcode(config?.shortcode ?? ""), [config]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("platform_mpesa_config")
        .update({ shortcode: shortcode.trim() || null, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Platform C2B receiving shortcode saved.");
      queryClient.invalidateQueries({ queryKey: ["platform-c2b"] });
      queryClient.invalidateQueries({ queryKey: ["platform-c2b-callback-status"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const registerCallbacks = useMutation({
    mutationFn: registerPlatformC2bCallbacks,
    onSuccess: () => {
      toast.success("Platform C2B callbacks registered with Safaricom.");
      queryClient.invalidateQueries({ queryKey: ["platform-c2b-callback-status"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div>
      <PageHeader
        title="Platform C2B"
        description="Receive tenant commission payments on the platform PayBill and match each C2B payment to its invoice automatically."
      />
      <section className="max-w-2xl rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Commission receiving PayBill</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tenants pay the exact invoice total to this PayBill and enter the invoice reference as the
          M-Pesa account number. Safaricom C2B callbacks record the receipt and match the reference
          and amount to mark the invoice paid.
        </p>
        <div className="mt-4 max-w-sm">
          <Label htmlFor="platform-shortcode">Platform PayBill shortcode</Label>
          <Input
            id="platform-shortcode"
            value={shortcode}
            onChange={(event) => setShortcode(event.target.value)}
            placeholder={isLoading ? "Loading…" : "Enter platform shortcode"}
            className="mt-1"
          />
        </div>
        <Button className="mt-4" onClick={() => save.mutate()} disabled={save.isPending}>
          Save shortcode
        </Button>
        <div className="mt-6 border-t pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">Safaricom C2B callbacks</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {callbackStatus?.registeredAt
                  ? `Registered ${new Date(callbackStatus.registeredAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}`
                  : "Register the platform callback URLs to enable automatic invoice matching."}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => registerCallbacks.mutate()}
              disabled={
                registerCallbacks.isPending ||
                !config?.shortcode ||
                !callbackStatus?.credentialsConfigured
              }
            >
              {registerCallbacks.isPending ? "Registering…" : "Register C2B callbacks"}
            </Button>
          </div>
          {callbackStatus && !callbackStatus.credentialsConfigured && (
            <p className="mt-3 text-sm text-destructive">
              Configure APP_BASE_URL, PLATFORM_MPESA_ENV, PLATFORM_MPESA_CONSUMER_KEY, and
              PLATFORM_MPESA_CONSUMER_SECRET in the server environment first.
            </p>
          )}
          {callbackStatus?.confirmationUrl && callbackStatus?.validationUrl && (
            <div className="mt-3 break-all rounded-lg bg-muted p-3 text-xs">
              <p>
                <span className="font-medium">Confirmation:</span> {callbackStatus.confirmationUrl}
              </p>
              <p className="mt-1">
                <span className="font-medium">Validation:</span> {callbackStatus.validationUrl}
              </p>
            </div>
          )}
        </div>
      </section>
      <section className="mt-6 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Recent PayBill transactions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          New payments and invoice matches appear here automatically.
        </p>
        {!transactions?.length ? (
          <p className="mt-4 text-sm text-muted-foreground">No C2B transactions received yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-4">Received</th>
                  <th className="pb-2 pr-4">Receipt</th>
                  <th className="pb-2 pr-4">Account reference</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">Invoice</th>
                  <th className="pb-2">Match result</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id} className="border-t">
                    <td className="py-2 pr-4 text-xs">
                      {new Date(transaction.transaction_time).toLocaleString("en-KE", {
                        timeZone: "Africa/Nairobi",
                      })}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{transaction.transaction_id}</td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {transaction.bill_ref_number || "—"}
                    </td>
                    <td className="py-2 pr-4">KES {Number(transaction.amount).toLocaleString()}</td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {transaction.invoiceNumber ?? "—"}
                    </td>
                    <td className="py-2">
                      <Badge variant={transaction.status === "matched" ? "default" : "secondary"}>
                        {transaction.status.replaceAll("_", " ")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
