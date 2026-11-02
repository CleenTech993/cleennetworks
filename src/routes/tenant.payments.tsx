import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { reviewDirectMpesaTransaction } from "@/lib/tenant-service.functions";

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
  const queryClient = useQueryClient();
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
  const { data: directTransactions, isLoading: directLoading } = useQuery({
    queryKey: ["direct-mpesa-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("direct_mpesa_transactions")
        .select(
          "id,transaction_id,transaction_time,amount,bill_ref_number,phone,first_name,last_name,suggested_customer_id,customer_id,status",
        )
        .order("transaction_time", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  const { data: pppoeCustomers } = useQuery({
    queryKey: ["direct-mpesa-pppoe-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,full_name,phone,pppoe_username,package_id")
        .eq("customer_type", "pppoe")
        .order("pppoe_username");
      if (error) throw error;
      return data;
    },
  });
  const { data: pppoePackages } = useQuery({
    queryKey: ["direct-mpesa-pppoe-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packages")
        .select("id,name,price,kind,active")
        .eq("kind", "pppoe")
        .eq("active", true)
        .order("price");
      if (error) throw error;
      return data;
    },
  });
  const review = useMutation({
    mutationFn: (input: {
      transactionId: string;
      action: "approve" | "reject";
      customerId?: string;
      packageId?: string;
    }) => reviewDirectMpesaTransaction({ data: input }),
    onSuccess: () => {
      toast.success("Direct payment review saved.");
      queryClient.invalidateQueries({ queryKey: ["direct-mpesa-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const [selections, setSelections] = useState<
    Record<string, { customerId: string; packageId: string }>
  >({});
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data ?? [];
    return (data ?? []).filter((p) =>
      [p.phone, p.mpesa_receipt, p.voucher_code].some((v) => v?.toLowerCase().includes(s)),
    );
  }, [q, data]);
  return (
    <div>
      <PageHeader
        title="Payments"
        description="STK and direct M-Pesa transactions, including PPPoE payment review."
      />
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Direct PayBill / Till payments</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Incoming C2B transactions are captured here. Confirm each payment against the M-Pesa
          statement, then match the customer and package before approving a PPPoE renewal.
        </p>
        {directLoading ? (
          <p className="text-sm text-muted-foreground">Loading direct payments…</p>
        ) : !directTransactions?.length ? (
          <EmptyState
            title="No direct payments received"
            description="Register Daraja callbacks in Notifications & Payments. Safaricom must support C2B callback registration for the shortcode."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-left">Amount / receipt</th>
                  <th className="px-3 py-2.5 text-left">Sender / reference</th>
                  <th className="px-3 py-2.5 text-left">PPPoE customer</th>
                  <th className="px-3 py-2.5 text-left">Package</th>
                  <th className="px-3 py-2.5 text-left">Review</th>
                </tr>
              </thead>
              <tbody>
                {directTransactions.map((transaction) => {
                  const selection = selections[transaction.id] ?? {
                    customerId: transaction.suggested_customer_id ?? "",
                    packageId: "",
                  };
                  const customer = pppoeCustomers?.find((item) => item.id === selection.customerId);
                  const packageId = selection.packageId || customer?.package_id || "";
                  return (
                    <tr key={transaction.id} className="border-t align-top">
                      <td className="whitespace-nowrap px-3 py-3">
                        {new Date(transaction.transaction_time).toLocaleString()}
                      </td>
                      <td className="px-3 py-3">
                        <div>KES {Number(transaction.amount).toLocaleString()}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {transaction.transaction_id}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div>
                          {[transaction.first_name, transaction.last_name]
                            .filter(Boolean)
                            .join(" ") || "M-Pesa customer"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {transaction.phone ?? "—"} · Ref: {transaction.bill_ref_number || "—"}
                        </div>
                      </td>
                      <td className="min-w-52 px-3 py-3">
                        {transaction.status === "received" ? (
                          <select
                            className="w-full rounded-md border bg-background px-2 py-2"
                            value={selection.customerId}
                            onChange={(event) =>
                              setSelections((current) => ({
                                ...current,
                                [transaction.id]: {
                                  customerId: event.target.value,
                                  packageId: "",
                                },
                              }))
                            }
                          >
                            <option value="">Select customer</option>
                            {pppoeCustomers?.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.pppoe_username ?? item.full_name ?? item.phone ?? item.id}
                              </option>
                            ))}
                          </select>
                        ) : (
                          (pppoeCustomers?.find(
                            (item) =>
                              item.id ===
                              (transaction.customer_id ?? transaction.suggested_customer_id),
                          )?.pppoe_username ?? transaction.status)
                        )}
                      </td>
                      <td className="min-w-44 px-3 py-3">
                        {transaction.status === "received" ? (
                          <select
                            className="w-full rounded-md border bg-background px-2 py-2"
                            value={packageId}
                            onChange={(event) =>
                              setSelections((current) => ({
                                ...current,
                                [transaction.id]: {
                                  ...selection,
                                  packageId: event.target.value,
                                },
                              }))
                            }
                          >
                            <option value="">Select package</option>
                            {pppoePackages?.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} — KES {Number(item.price).toLocaleString()}
                              </option>
                            ))}
                          </select>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {transaction.status === "received" ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={!selection.customerId || !packageId || review.isPending}
                              onClick={() =>
                                review.mutate({
                                  transactionId: transaction.id,
                                  action: "approve",
                                  customerId: selection.customerId,
                                  packageId,
                                })
                              }
                            >
                              Approve & renew
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={review.isPending}
                              onClick={() =>
                                review.mutate({
                                  transactionId: transaction.id,
                                  action: "reject",
                                })
                              }
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <Badge
                            variant={transaction.status === "approved" ? "default" : "secondary"}
                          >
                            {transaction.status}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
