import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { reviewDirectMpesaTransaction } from "@/lib/tenant-service.functions";
import {
  buildDirectMpesaCsv,
  buildPaymentCsv,
  normalizePaymentSearch,
  summarizeDirectMpesa,
  summarizePayments,
} from "@/lib/payment-report";

const PAYMENT_PAGE_SIZE = 100;

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
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [directQ, setDirectQ] = useState("");
  const [directStatusFilter, setDirectStatusFilter] = useState("all");
  const [directDateFrom, setDirectDateFrom] = useState("");
  const [directDateTo, setDirectDateTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportingDirect, setExportingDirect] = useState(false);
  const deferredSearch = useDeferredValue(q);
  const deferredDirectSearch = useDeferredValue(directQ);
  const queryClient = useQueryClient();
  const {
    data: paymentPages,
    isLoading,
    error: paymentError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["payments", statusFilter, dateFrom, dateTo, deferredSearch],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const searchTerm = normalizePaymentSearch(deferredSearch);
      if (deferredSearch.trim() && !searchTerm) {
        return { payments: [], count: 0, hasMore: false, nextOffset: pageParam };
      }

      let query = supabase
        .from("payments")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(pageParam, pageParam + PAYMENT_PAGE_SIZE - 1);
      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (dateFrom)
        query = query.gte("created_at", new Date(`${dateFrom}T00:00:00.000Z`).toISOString());
      if (dateTo) {
        const nextDay = new Date(`${dateTo}T00:00:00.000Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        query = query.lt("created_at", nextDay.toISOString());
      }
      if (searchTerm) {
        query = query.or(
          `phone.ilike.%${searchTerm}%,mpesa_receipt.ilike.%${searchTerm}%,voucher_code.ilike.%${searchTerm}%`,
        );
      }
      const { data, count, error } = await query;
      if (error) throw error;
      const payments = data ?? [];
      const total = count ?? 0;
      return {
        payments,
        count: total,
        hasMore: pageParam + payments.length < total,
        nextOffset: pageParam + payments.length,
      };
    },
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextOffset : undefined),
  });
  const {
    data: directPaymentPages,
    isLoading: directLoading,
    error: directPaymentError,
    hasNextPage: hasMoreDirectPayments,
    fetchNextPage: fetchMoreDirectPayments,
    isFetchingNextPage: isFetchingMoreDirectPayments,
  } = useInfiniteQuery({
    queryKey: [
      "direct-mpesa-transactions",
      directStatusFilter,
      directDateFrom,
      directDateTo,
      deferredDirectSearch,
    ],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const searchTerm = normalizePaymentSearch(deferredDirectSearch);
      if (deferredDirectSearch.trim() && !searchTerm) {
        return { transactions: [], count: 0, hasMore: false, nextOffset: pageParam };
      }

      let query = supabase
        .from("direct_mpesa_transactions")
        .select(
          "id,transaction_id,transaction_time,amount,bill_ref_number,phone,first_name,last_name,suggested_customer_id,customer_id,status",
          { count: "exact" },
        )
        .order("transaction_time", { ascending: false })
        .order("id", { ascending: false })
        .range(pageParam, pageParam + PAYMENT_PAGE_SIZE - 1);
      if (directStatusFilter !== "all") query = query.eq("status", directStatusFilter);
      if (directDateFrom)
        query = query.gte(
          "transaction_time",
          new Date(`${directDateFrom}T00:00:00.000Z`).toISOString(),
        );
      if (directDateTo) {
        const nextDay = new Date(`${directDateTo}T00:00:00.000Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        query = query.lt("transaction_time", nextDay.toISOString());
      }
      if (searchTerm) {
        query = query.or(
          `transaction_id.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%,bill_ref_number.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`,
        );
      }
      const { data, count, error } = await query;
      if (error) throw error;
      const transactions = data ?? [];
      const total = count ?? 0;
      return {
        transactions,
        count: total,
        hasMore: pageParam + transactions.length < total,
        nextOffset: pageParam + transactions.length,
      };
    },
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextOffset : undefined),
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
    mutationFn: (
      input:
        | { transactionId: string; action: "reject" }
        | { transactionId: string; action: "approve"; customerId: string; packageId: string },
    ) => reviewDirectMpesaTransaction({ data: input }),
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
  const rows = paymentPages?.pages.flatMap((page) => page.payments) ?? [];
  const directTransactions = directPaymentPages?.pages.flatMap((page) => page.transactions) ?? [];
  const directMatchingCount = directPaymentPages?.pages[0]?.count ?? 0;
  const matchingCount = paymentPages?.pages[0]?.count ?? 0;
  const paymentSummary = summarizePayments(rows);
  const directSummary = summarizeDirectMpesa(directTransactions ?? []);

  async function exportPayments() {
    setExporting(true);
    try {
      let pages = paymentPages?.pages ?? [];
      while (pages.length && pages[pages.length - 1]?.hasMore) {
        const result = await fetchNextPage();
        if (result.isError) throw result.error;
        pages = result.data.pages;
      }
      const allRows = pages.flatMap((page) => page.payments);
      if (!allRows.length) return;
      const csv = buildPaymentCsv(allRows);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export payments.");
    } finally {
      setExporting(false);
    }
  }

  async function exportDirectPayments() {
    setExportingDirect(true);
    try {
      let pages = directPaymentPages?.pages ?? [];
      while (pages.length && pages[pages.length - 1]?.hasMore) {
        const result = await fetchMoreDirectPayments();
        if (result.isError) throw result.error;
        pages = result.data.pages;
      }
      const allTransactions = pages.flatMap((page) => page.transactions);
      if (!allTransactions.length) return;
      const csv = buildDirectMpesaCsv(allTransactions);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `direct-mpesa-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export direct payments.");
    } finally {
      setExportingDirect(false);
    }
  }
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
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={directQ}
              onChange={(event) => setDirectQ(event.target.value)}
              placeholder="Search receipt, phone or reference"
              aria-label="Search direct M-Pesa payments"
            />
          </div>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={directStatusFilter}
            onChange={(event) => setDirectStatusFilter(event.target.value)}
            aria-label="Filter direct payments by status"
          >
            <option value="all">All review statuses</option>
            <option value="received">Awaiting review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <Input
            type="date"
            value={directDateFrom}
            onChange={(event) => setDirectDateFrom(event.target.value)}
            aria-label="Direct payments from date"
          />
          <Input
            type="date"
            value={directDateTo}
            onChange={(event) => setDirectDateTo(event.target.value)}
            aria-label="Direct payments through date"
          />
        </div>
        {!directLoading && directTransactions?.length ? (
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">C2B captured (loaded)</p>
              <p className="mt-1 text-lg font-semibold">
                KES {directSummary.capturedAmount.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">
                {directSummary.capturedCount} receipts
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Awaiting review</p>
              <p className="mt-1 text-lg font-semibold">
                KES {directSummary.reviewAmount.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">
                {directSummary.reviewCount} transactions
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Approved renewals</p>
              <p className="mt-1 text-lg font-semibold">{directSummary.approvedCount}</p>
              <p className="text-xs text-muted-foreground">Customer service renewed</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Rejected transactions</p>
              <p className="mt-1 text-lg font-semibold">{directSummary.rejectedCount}</p>
              <p className="text-xs text-muted-foreground">No service renewal</p>
            </div>
          </div>
        ) : null}
        {directLoading ? (
          <p className="text-sm text-muted-foreground">Loading direct payments…</p>
        ) : directPaymentError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            Could not load direct M-Pesa payments: {directPaymentError.message}
          </p>
        ) : !directTransactions.length ? (
          <EmptyState
            title={
              directMatchingCount ? "No direct payments loaded" : "No matching direct payments"
            }
            description={
              directQ || directStatusFilter !== "all" || directDateFrom || directDateTo
                ? "Try changing the search or filters."
                : "Register Daraja callbacks in Notifications & Payments. Safaricom must support C2B callback registration for the shortcode."
            }
          />
        ) : (
          <>
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {directTransactions.length} loaded of {directMatchingCount} matching direct
                M-Pesa transactions; the export includes all matches.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 self-start sm:self-auto"
                onClick={exportDirectPayments}
                disabled={exportingDirect || isFetchingMoreDirectPayments || directLoading}
              >
                <Download className="h-4 w-4" />
                {exportingDirect
                  ? "Preparing full export…"
                  : `Export all ${directMatchingCount} matching`}
              </Button>
            </div>
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
                    const customer = pppoeCustomers?.find(
                      (item) => item.id === selection.customerId,
                    );
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
            {hasMoreDirectPayments && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => void fetchMoreDirectPayments()}
                  disabled={isFetchingMoreDirectPayments}
                >
                  {isFetchingMoreDirectPayments
                    ? "Loading more…"
                    : `Load more direct payments (${directTransactions.length} of ${directMatchingCount})`}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search M-Pesa code, phone or voucher"
              aria-label="Search payments"
            />
          </div>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter payments by status"
          >
            <option value="all">All statuses</option>
            <option value="success">Successful</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <Input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            aria-label="Payments from date"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            aria-label="Payments through date"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 self-end"
          onClick={exportPayments}
          disabled={!rows.length || exporting || isLoading}
        >
          <Download className="h-4 w-4" />
          {exporting ? "Preparing full export…" : `Export all ${matchingCount} matching`}
        </Button>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Successful amount (loaded matches)</p>
          <p className="mt-1 text-lg font-semibold">
            KES {paymentSummary.successfulAmount.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">
            {paymentSummary.successfulCount} successful payments
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Pending (loaded matches)</p>
          <p className="mt-1 text-lg font-semibold">
            KES {paymentSummary.pendingAmount.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">{paymentSummary.pendingCount} payments</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Failed / cancelled (loaded matches)</p>
          <p className="mt-1 text-lg font-semibold">
            KES {paymentSummary.unsuccessfulAmount.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">
            {paymentSummary.unsuccessfulCount} payments
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Matching transactions</p>
          <p className="mt-1 text-lg font-semibold">{paymentSummary.totalCount}</p>
          <p className="text-xs text-muted-foreground">
            {rows.length} loaded of {matchingCount} matching
          </p>
        </div>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : paymentError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          Could not load payments: {paymentError.message}
        </p>
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
        <>
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
          {hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage
                  ? "Loading more…"
                  : `Load more payments (${rows.length} of ${matchingCount})`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
