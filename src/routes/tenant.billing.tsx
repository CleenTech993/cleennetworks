import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, Printer, ReceiptText } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPlatformInvoicePaymentDetails } from "@/lib/platform-billing.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/tenant/billing")({ component: TenantBilling });

function formatDate(value: string | null, withTime = false): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "Africa/Nairobi",
  }).format(new Date(value));
}

function formatAmount(amount: number): string {
  return `KES ${Number(amount).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function TenantBilling() {
  const { tenantId } = useAuth();
  const [printingId, setPrintingId] = useState<string | null>(null);
  const {
    data: invoices,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["tenant-platform-invoices", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_commissions")
        .select(
          "id,invoice_number,period_start,period_end,gross_amount,commission_amount,commission_rate_pct,status,mpesa_receipt,issued_at,due_at,email_status,email_error,email_sent_at",
        )
        .eq("tenant_id", tenantId!)
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: paymentDetails, error: paymentDetailsError } = useQuery({
    queryKey: ["platform-invoice-payment-details"],
    queryFn: getPlatformInvoicePaymentDetails,
  });

  function printInvoice(id: string) {
    setPrintingId(id);
    window.setTimeout(() => window.print(), 0);
  }

  if (error) throw error;

  return (
    <div>
      {printingId && (
        <style>{`@media print {
          body * { visibility: hidden !important; }
          #invoice-print-${printingId}, #invoice-print-${printingId} * { visibility: visible !important; }
          #invoice-print-${printingId} { position: fixed; inset: 0; width: 100%; background: white; color: black; border: 0; box-shadow: none; }
          .no-print { display: none !important; }
        }`}</style>
      )}
      <PageHeader
        title="Platform invoices"
        description="Review and settle monthly platform commission invoices."
      />

      <div className="mb-5 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">How to pay</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Send the invoiced amount as a separate M-Pesa C2B payment to the platform shortcode.
          Settlements are confirmed by the platform after receipt verification.
        </p>
        <p className="mt-2 font-medium">
          Platform PayBill / Till: {paymentDetails?.shortcode ?? "Contact platform support"}
        </p>
        {paymentDetailsError && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Could not load the platform payment details.
          </p>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading invoices…</p>
      ) : !invoices?.length ? (
        <EmptyState
          title="No invoices yet"
          description="An invoice will appear here after the first month in which you receive successful customer payments."
        />
      ) : (
        <div className="space-y-4">
          {invoices.map((invoice) => {
            const isOverdue =
              invoice.status === "pending" &&
              !!invoice.due_at &&
              new Date(invoice.due_at).getTime() <= Date.now();
            return (
              <section
                id={`invoice-print-${invoice.id}`}
                key={invoice.id}
                className="rounded-xl border bg-card p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <ReceiptText className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                      <h2 className="font-semibold">
                        {invoice.invoice_number ?? "Commission record"}
                      </h2>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatDate(invoice.period_start)} –{" "}
                      {formatDate(
                        new Date(new Date(invoice.period_end).getTime() - 1000).toISOString(),
                      )}
                    </p>
                  </div>
                  <div className="no-print flex items-center gap-2">
                    <Badge
                      variant={
                        invoice.status === "collected"
                          ? "default"
                          : isOverdue
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {invoice.status === "collected" ? "Paid" : isOverdue ? "Overdue" : "Unpaid"}
                    </Badge>
                    {invoice.invoice_number && (
                      <Button variant="outline" size="sm" onClick={() => printInvoice(invoice.id)}>
                        <Printer aria-hidden="true" />
                        Print / Save PDF
                      </Button>
                    )}
                  </div>
                </div>

                {invoice.invoice_number ? (
                  <>
                    <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Issued</dt>
                        <dd className="font-medium">{formatDate(invoice.issued_at, true)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Due</dt>
                        <dd
                          className={isOverdue ? "font-semibold text-destructive" : "font-medium"}
                        >
                          {formatDate(invoice.due_at, true)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Successful customer payments</dt>
                        <dd className="font-medium">{formatAmount(invoice.gross_amount)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">
                          Commission
                          {invoice.commission_rate_pct != null &&
                            ` (${invoice.commission_rate_pct}%)`}
                        </dt>
                        <dd className="text-lg font-semibold">
                          {formatAmount(invoice.commission_amount)}
                        </dd>
                      </div>
                      {invoice.mpesa_receipt && (
                        <div>
                          <dt className="text-muted-foreground">Settlement receipt</dt>
                          <dd className="font-mono">{invoice.mpesa_receipt}</dd>
                        </div>
                      )}
                    </dl>

                    <div className="no-print mt-4 flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground">
                      {invoice.email_status === "sent" ? (
                        <p>Invoice emailed {formatDate(invoice.email_sent_at, true)}.</p>
                      ) : invoice.email_status === "failed" ? (
                        <>
                          <AlertCircle
                            className="h-4 w-4 shrink-0 text-destructive"
                            aria-hidden="true"
                          />
                          <p>
                            {invoice.email_error ??
                              "Invoice email delivery failed. Check the support email in Settings."}
                          </p>
                        </>
                      ) : (
                        <p>Invoice email: {invoice.email_status}</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    This is a legacy commission record. New monthly invoices include a due date and
                    invoice number.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
