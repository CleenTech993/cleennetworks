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
  savePlatformC2bSettings,
} from "@/lib/platform-invoice.functions";

export const Route = createFileRoute("/super-admin/payments")({ component: PlatformPayments });

function PlatformPayments() {
  const queryClient = useQueryClient();
  const [shortcode, setShortcode] = useState("");
  const [appBaseUrl, setAppBaseUrl] = useState("");
  const [environment, setEnvironment] = useState<"" | "sandbox" | "production">("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
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
  useEffect(() => {
    if (!callbackStatus) return;
    setAppBaseUrl(callbackStatus.appBaseUrl ?? "");
    setEnvironment(callbackStatus.environment ?? "");
  }, [callbackStatus]);

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
  const saveSettings = useMutation({
    mutationFn: savePlatformC2bSettings,
    onSuccess: () => {
      toast.success("Platform Daraja settings saved securely.");
      setConsumerKey("");
      setConsumerSecret("");
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
          <h3 className="font-medium">Daraja callback credentials</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Values are encrypted on the server. Full saved credentials are never sent back to this
            page; leave a credential blank to keep its current value.
          </p>
          <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="platform-app-url">Public application URL</Label>
              <Input
                id="platform-app-url"
                type="url"
                value={appBaseUrl}
                onChange={(event) => setAppBaseUrl(event.target.value)}
                placeholder="https://your-domain.example"
                autoComplete="url"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="platform-mpesa-environment">Daraja environment</Label>
              <select
                id="platform-mpesa-environment"
                value={environment}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "" || value === "sandbox" || value === "production") {
                    setEnvironment(value);
                  }
                }}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose an environment</option>
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </div>
            <div>
              <Label htmlFor="platform-consumer-key">
                Consumer key
                {callbackStatus?.consumerKeyLast4
                  ? ` (saved ••••${callbackStatus.consumerKeyLast4})`
                  : ""}
              </Label>
              <Input
                id="platform-consumer-key"
                type="password"
                value={consumerKey}
                onChange={(event) => setConsumerKey(event.target.value)}
                placeholder="Enter to set or replace"
                autoComplete="new-password"
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="platform-consumer-secret">
                Consumer secret
                {callbackStatus?.consumerSecretLast4
                  ? ` (saved ••••${callbackStatus.consumerSecretLast4})`
                  : ""}
              </Label>
              <Input
                id="platform-consumer-secret"
                type="password"
                value={consumerSecret}
                onChange={(event) => setConsumerSecret(event.target.value)}
                placeholder="Enter to set or replace"
                autoComplete="new-password"
                className="mt-1"
              />
            </div>
          </div>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() =>
              saveSettings.mutate({
                data: {
                  appBaseUrl: appBaseUrl.trim() || undefined,
                  environment: environment || undefined,
                  consumerKey: consumerKey.trim() || undefined,
                  consumerSecret: consumerSecret.trim() || undefined,
                },
              })
            }
            disabled={saveSettings.isPending}
          >
            {saveSettings.isPending ? "Saving…" : "Save Daraja settings"}
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
                Enter the public application URL, Daraja environment, consumer key, and consumer
                secret above to enable callback registration.
              </p>
            )}
            {callbackStatus?.confirmationUrl && callbackStatus?.validationUrl && (
              <div className="mt-3 break-all rounded-lg bg-muted p-3 text-xs">
                <p>
                  <span className="font-medium">Confirmation:</span>{" "}
                  {callbackStatus.confirmationUrl}
                </p>
                <p className="mt-1">
                  <span className="font-medium">Validation:</span> {callbackStatus.validationUrl}
                </p>
              </div>
            )}
          </div>
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
