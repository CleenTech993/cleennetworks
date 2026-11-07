import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, Printer, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPlatformInvoicePaymentDetails } from "@/lib/platform-billing.functions";
import {
  requestPlatformInvoiceStkPush,
  submitPlatformInvoiceReceipt,
} from "@/lib/platform-invoice.functions";
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Please try again in a moment.";
}

function TenantBilling() {
  const { tenantId } = useAuth();
  const queryClient = useQueryClient();
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const [phones, setPhones] = useState<Record<string, string>>({});
  const {
    data: invoices,
    isLoading,
    isFetching,
    refetch,
    error,
    isError,
  } = useQuery({
    queryKey: ["tenant-platform-invoices", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_commissions")
        .select(
          "id,invoice_number,payment_reference,period_start,period_end,gross_amount,commission_amount,commission_rate_pct,hotspot_gross_amount,pppoe_gross_amount,hotspot_commission_amount,pppoe_commission_amount,hotspot_commission_rate_pct,pppoe_commission_rate_pct,tenant_mpesa_receipt,status,mpesa_receipt,issued_at,due_at,email_status,email_error,email_sent_at",
        )
        .eq("tenant_id", tenantId!)
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
    refetchInterval: 10_000,
  });
  const submitReceipt = useMutation({
    mutationFn: ({ invoiceId, receipt }: { invoiceId: string; receipt: string }) =>
      submitPlatformInvoiceReceipt({ data: { invoiceId, receipt } }),
    onSuccess: (_result, variables) => {
      toast.success("Transaction code submitted");
      setReceipts((current) => ({ ...current, [variables.invoiceId]: "" }));
      void queryClient.invalidateQueries({ queryKey: ["tenant-platform-invoices", tenantId] });
    },
    onError: (submissionError: Error) => toast.error(submissionError.message),
  });
  const requestStk = useMutation({
    mutationFn: ({ invoiceId, phone }: { invoiceId: string; phone: string }) =>
      requestPlatformInvoiceStkPush({ data: { invoiceId, phone } }),
    onSuccess: (_result, variables) => {
      toast.success("M-Pesa prompt sent. Check the phone and enter your PIN.");
      void queryClient.invalidateQueries({ queryKey: ["tenant-platform-invoices", tenantId] });
      setPhones((current) => ({ ...current, [variables.invoiceId]: variables.phone }));
    },
    onError: (stkError: Error) => toast.error(stkError.message),
  });
  const { data: paymentDetails, error: paymentDetailsError } = useQuery({
    queryKey: ["platform-invoice-payment-details"],
    queryFn: getPlatformInvoicePaymentDetails,
  });

  function printInvoice(id: string) {
    setPrintingId(id);
    window.setTimeout(() => window.print(), 0);
  }

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
          Pay the exact total using the invoice-specific reference. Send money directly to the
          platform account, or request an M-Pesa prompt on your phone when available.
        </p>
        <p className="mt-2 font-medium">
          Platform {paymentDetails?.merchantType === "buygoods" ? "Buy Goods Till" : "PayBill"}:{" "}
          {paymentDetails?.shortcode ?? "Contact platform support"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          When sending money directly, enter the invoice reference as the account/reference number.
          Invoice totals are rounded to the nearest whole KES for M-Pesa.
        </p>
        {paymentDetailsError && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Could not load the platform payment details.
          </p>
        )}
      </div>

      {isError && (
        <div
          role="alert"
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <div>
            <p className="font-medium text-destructive">Could not load platform invoices.</p>
            <p className="mt-1 text-muted-foreground">{errorMessage(error)}</p>
          </div>
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? "Retrying…" : "Try again"}
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading invoices…</p>
      ) : isError && !invoices ? null : !invoices?.length ? (
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
                      {invoice.status === "collected"
                        ? "Paid"
                        : isOverdue
                          ? "Overdue"
                          : invoice.tenant_mpesa_receipt
                            ? "Awaiting confirmation"
                            : "Unpaid"}
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
                        <dt className="text-muted-foreground">M-Pesa account/reference number</dt>
                        <dd className="font-mono font-semibold">
                          {invoice.payment_reference ?? invoice.invoice_number ?? "Contact support"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Successful customer payments</dt>
                        <dd className="font-medium">{formatAmount(invoice.gross_amount)}</dd>
                      </div>
                      {invoice.hotspot_gross_amount != null &&
                        invoice.pppoe_gross_amount != null &&
                        invoice.hotspot_commission_amount != null &&
                        invoice.pppoe_commission_amount != null && (
                          <>
                            <div>
                              <dt className="text-muted-foreground">
                                Hotspot / voucher / phone + TV income (
                                {invoice.hotspot_commission_rate_pct ?? 2}% commission)
                              </dt>
                              <dd className="font-medium">
                                {formatAmount(invoice.hotspot_gross_amount)} ·{" "}
                                {formatAmount(invoice.hotspot_commission_amount)} due
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">
                                PPPoE income ({invoice.pppoe_commission_rate_pct ?? 1}% commission)
                              </dt>
                              <dd className="font-medium">
                                {formatAmount(invoice.pppoe_gross_amount)} ·{" "}
                                {formatAmount(invoice.pppoe_commission_amount)} due
                              </dd>
                            </div>
                          </>
                        )}
                      {invoice.hotspot_commission_amount != null &&
                        invoice.pppoe_commission_amount != null &&
                        Number(invoice.commission_amount) !==
                          Number(invoice.hotspot_commission_amount) +
                            Number(invoice.pppoe_commission_amount) && (
                          <div>
                            <dt className="text-muted-foreground">
                              Whole-shilling M-Pesa adjustment
                            </dt>
                            <dd className="font-medium">
                              {formatAmount(
                                Number(invoice.commission_amount) -
                                  Number(invoice.hotspot_commission_amount) -
                                  Number(invoice.pppoe_commission_amount),
                              )}
                            </dd>
                          </div>
                        )}
                      <div>
                        <dt className="text-muted-foreground">
                          Total commission due
                          {invoice.commission_rate_pct != null &&
                            ` (${invoice.commission_rate_pct}%)`}
                        </dt>
                        <dd className="text-lg font-semibold">
                          {formatAmount(invoice.commission_amount)}
                        </dd>
                      </div>
                      {invoice.mpesa_receipt && (
                        <div>
                          <dt className="text-muted-foreground">Confirmed payment code</dt>
                          <dd className="font-mono">{invoice.mpesa_receipt}</dd>
                        </div>
                      )}
                      {invoice.tenant_mpesa_receipt && invoice.status === "pending" && (
                        <div>
                          <dt className="text-muted-foreground">Submitted transaction code</dt>
                          <dd className="font-mono">{invoice.tenant_mpesa_receipt}</dd>
                        </div>
                      )}
                    </dl>

                    {invoice.status === "pending" && (
                      <div className="no-print mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
                        {paymentDetails?.stkAvailable && (
                          <div className="w-full rounded-xl bg-muted/50 p-4">
                            <p className="text-sm font-medium">Pay with an M-Pesa prompt</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Enter the M-Pesa phone number. We’ll send a prompt for the exact
                              invoice amount.
                            </p>
                            <div className="mt-3 flex flex-wrap items-end gap-2">
                              <div className="min-w-56 flex-1">
                                <label
                                  htmlFor={`invoice-phone-${invoice.id}`}
                                  className="text-sm font-medium"
                                >
                                  M-Pesa phone number
                                </label>
                                <Input
                                  id={`invoice-phone-${invoice.id}`}
                                  type="tel"
                                  inputMode="tel"
                                  autoComplete="tel"
                                  value={phones[invoice.id] ?? ""}
                                  maxLength={20}
                                  placeholder="e.g. 0712345678"
                                  onChange={(event) =>
                                    setPhones({ ...phones, [invoice.id]: event.target.value })
                                  }
                                  className="mt-1"
                                />
                              </div>
                              <Button
                                onClick={() =>
                                  requestStk.mutate({
                                    invoiceId: invoice.id,
                                    phone: phones[invoice.id] ?? "",
                                  })
                                }
                                disabled={
                                  requestStk.isPending || !(phones[invoice.id] ?? "").trim()
                                }
                              >
                                {requestStk.isPending ? "Sending prompt…" : "Pay with M-Pesa"}
                              </Button>
                            </div>
                          </div>
                        )}
                        <p className="w-full text-xs text-muted-foreground">
                          For direct Till/PayBill payments, enter the invoice reference as the
                          account number. If it does not match automatically, submit the receipt
                          below for manual review.
                        </p>
                        <div className="min-w-56 flex-1">
                          <label
                            htmlFor={`invoice-receipt-${invoice.id}`}
                            className="text-sm font-medium"
                          >
                            M-Pesa transaction code
                          </label>
                          <Input
                            id={`invoice-receipt-${invoice.id}`}
                            value={receipts[invoice.id] ?? ""}
                            maxLength={40}
                            placeholder="e.g. QAB123XYZ"
                            onChange={(event) =>
                              setReceipts({ ...receipts, [invoice.id]: event.target.value })
                            }
                            className="mt-1 font-mono uppercase"
                          />
                        </div>
                        <Button
                          onClick={() =>
                            submitReceipt.mutate({
                              invoiceId: invoice.id,
                              receipt: receipts[invoice.id] ?? "",
                            })
                          }
                          disabled={submitReceipt.isPending || !(receipts[invoice.id] ?? "").trim()}
                        >
                          {submitReceipt.isPending ? "Submitting…" : "Submit code"}
                        </Button>
                      </div>
                    )}

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
