import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, StatCard } from "@/components/dashboard-shell";
import { StaffInternetGrants } from "@/components/staff-internet-grants";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatTenantDate } from "@/lib/tenant-customization";

export const Route = createFileRoute("/tenant/customer-billing")({
  head: () => ({
    meta: [
      { title: "Customer billing — Tenant console" },
      { name: "description", content: "Customer renewal invoices and prepaid payment ledger." },
    ],
  }),
  component: CustomerBilling,
});

function CustomerBilling() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { tenantId, roles } = useAuth();
  const canGrantStaffInternet = roles.includes("tenant_admin");
  const {
    data: invoices = [],
    isLoading: invoicesLoading,
    error: invoicesError,
  } = useQuery({
    queryKey: ["customer-invoices", tenantId],
    enabled: Boolean(tenantId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_invoices")
        .select(
          "id,invoice_number,customer_id,package_id,package_name,amount,status,issued_at,due_at,paid_at,payment_id",
        )
        .order("issued_at", { ascending: false })
        .limit(250);
      if (error) throw error;
      return data;
    },
  });
  const {
    data: payments = [],
    isLoading: paymentsLoading,
    error: paymentsError,
  } = useQuery({
    queryKey: ["customer-billing-payments", tenantId],
    enabled: Boolean(tenantId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id,customer_id,package_id,customer_invoice_id,phone,amount,status,provider,mpesa_receipt,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(250);
      if (error) throw error;
      return data;
    },
  });
  const customerIds = useMemo(
    () =>
      [
        ...new Set([
          ...invoices.map((invoice) => invoice.customer_id),
          ...payments.flatMap((payment) => (payment.customer_id ? [payment.customer_id] : [])),
        ]),
      ].sort(),
    [invoices, payments],
  );
  const packageIds = useMemo(
    () =>
      [
        ...new Set([
          ...invoices.map((invoice) => invoice.package_id),
          ...payments.flatMap((payment) => (payment.package_id ? [payment.package_id] : [])),
        ]),
      ].sort(),
    [invoices, payments],
  );
  const {
    data: customers = [],
    isLoading: customersLoading,
    error: customersError,
  } = useQuery({
    queryKey: ["customer-billing-customers", tenantId, customerIds],
    enabled: Boolean(tenantId) && customerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,full_name,phone")
        .in("id", customerIds);
      if (error) throw error;
      return data;
    },
  });
  const {
    data: packages = [],
    isLoading: packagesLoading,
    error: packagesError,
  } = useQuery({
    queryKey: ["customer-billing-packages", tenantId, packageIds],
    enabled: Boolean(tenantId) && packageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packages")
        .select("id,name,kind")
        .in("id", packageIds);
      if (error) throw error;
      return data;
    },
  });

  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const packageById = useMemo(() => new Map(packages.map((pkg) => [pkg.id, pkg])), [packages]);
  const openInvoices = invoices.filter((invoice) =>
    ["pending", "overdue", "partial"].includes(invoice.status),
  );
  const collected = payments
    .filter((payment) => payment.status === "success")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const entries = useMemo(
    () => [
      ...invoices.map((invoice) => ({
        id: `invoice-${invoice.id}`,
        kind: "Invoice",
        reference: invoice.invoice_number,
        customerId: invoice.customer_id,
        phone: null,
        packageId: invoice.package_id,
        packageName: invoice.package_name,
        amount: Number(invoice.amount),
        status: invoice.status,
        date: invoice.issued_at,
        detail: invoice.status === "paid" ? "Paid" : `Due ${formatTenantDate(invoice.due_at)}`,
      })),
      ...payments.map((payment) => ({
        id: `payment-${payment.id}`,
        kind:
          packageById.get(payment.package_id ?? "")?.kind === "pppoe"
            ? "PPPoE payment"
            : "Prepaid payment",
        reference: payment.mpesa_receipt ?? "No receipt yet",
        customerId: payment.customer_id,
        phone: payment.phone,
        packageId: payment.package_id,
        packageName: packageById.get(payment.package_id ?? "")?.name ?? "",
        amount: Number(payment.amount),
        status: payment.status,
        date: payment.created_at,
        detail: payment.mpesa_receipt ?? payment.phone ?? "Awaiting receipt",
      })),
    ],
    [invoices, payments, packageById],
  );
  const filtered = entries.filter((entry) => {
    const customer = customerById.get(entry.customerId ?? "");
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      [entry.reference, entry.phone, customer?.full_name, customer?.phone, entry.packageName].some(
        (value) => value?.toLowerCase().includes(term),
      );
    const matchesStatus = statusFilter === "all" || entry.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customer billing"
        description="PPPoE renewal invoices and the payment ledger, including prepaid hotspot M-Pesa receipts."
      />
      {canGrantStaffInternet && tenantId && <StaffInternetGrants tenantId={tenantId} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open invoices" value={openInvoices.length} hint="Pending or overdue" />
        <StatCard
          label="Outstanding"
          value={`KES ${openInvoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0).toLocaleString()}`}
          hint="Current invoice records"
        />
        <StatCard
          label="Payments collected"
          value={`KES ${collected.toLocaleString()}`}
          hint="Recent successful payments"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-md"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search customer, phone, package or reference"
          aria-label="Search customer billing ledger"
        />
        <select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter customer billing by status"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="success">Successful payment</option>
          <option value="failed">Failed payment</option>
        </select>
      </div>
      {invoicesError || paymentsError || customersError || packagesError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
        >
          Could not load the customer billing ledger:{" "}
          {invoicesError instanceof Error
            ? invoicesError.message
            : paymentsError instanceof Error
              ? paymentsError.message
              : customersError instanceof Error
                ? customersError.message
                : packagesError instanceof Error
                  ? packagesError.message
                  : "Try refreshing the page."}
        </p>
      ) : invoicesLoading || paymentsLoading || customersLoading || packagesLoading ? (
        <p className="text-sm text-muted-foreground">Loading customer billing…</p>
      ) : !filtered.length ? (
        <EmptyState
          title={
            search || statusFilter !== "all"
              ? "No matching billing records"
              : "No billing records yet"
          }
          description="Renewal invoices and customer payments will appear here."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Record</th>
                <th className="p-3">Reference</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Status</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const customer = customerById.get(entry.customerId ?? "");
                return (
                  <tr key={entry.id} className="border-t">
                    <td className="whitespace-nowrap p-3">{formatTenantDate(entry.date)}</td>
                    <td className="p-3">
                      <span className="block font-medium">{customer?.full_name ?? "Walk-in"}</span>
                      <span className="text-xs text-muted-foreground">
                        {customer?.phone ?? entry.phone ?? "No phone"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="block">{entry.kind}</span>
                      <span className="text-xs text-muted-foreground">{entry.packageName}</span>
                    </td>
                    <td className="whitespace-nowrap p-3 font-mono text-xs">{entry.reference}</td>
                    <td className="whitespace-nowrap p-3">KES {entry.amount.toLocaleString()}</td>
                    <td className="p-3">
                      <Badge
                        variant={
                          ["paid", "success"].includes(entry.status) ? "default" : "secondary"
                        }
                      >
                        {entry.status}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap p-3 text-muted-foreground">{entry.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t p-3 text-xs text-muted-foreground">
            Showing up to 250 recent invoices and 250 recent payments.
          </p>
        </div>
      )}
    </div>
  );
}
