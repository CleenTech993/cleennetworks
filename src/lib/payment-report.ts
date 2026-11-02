export interface PaymentReportRow {
  id: string;
  created_at: string;
  phone: string | null;
  amount: number;
  mpesa_receipt: string | null;
  voucher_code: string | null;
  status: string;
}

export interface PaymentSummary {
  totalCount: number;
  successfulCount: number;
  successfulAmount: number;
  pendingCount: number;
  pendingAmount: number;
  unsuccessfulCount: number;
  unsuccessfulAmount: number;
}

export function summarizePayments(
  payments: Pick<PaymentReportRow, "amount" | "status">[],
): PaymentSummary {
  return payments.reduce<PaymentSummary>(
    (summary, payment) => {
      const amount = Number(payment.amount);
      if (!Number.isFinite(amount)) return summary;
      summary.totalCount++;
      if (payment.status === "success") {
        summary.successfulCount++;
        summary.successfulAmount += amount;
      } else if (payment.status === "pending") {
        summary.pendingCount++;
        summary.pendingAmount += amount;
      } else if (payment.status === "failed" || payment.status === "cancelled") {
        summary.unsuccessfulCount++;
        summary.unsuccessfulAmount += amount;
      }
      return summary;
    },
    {
      totalCount: 0,
      successfulCount: 0,
      successfulAmount: 0,
      pendingCount: 0,
      pendingAmount: 0,
      unsuccessfulCount: 0,
      unsuccessfulAmount: 0,
    },
  );
}

export function summarizeDirectMpesa(transactions: { amount: number; status: string }[]) {
  return transactions.reduce(
    (summary, transaction) => {
      const amount = Number(transaction.amount);
      if (!Number.isFinite(amount)) return summary;
      summary.capturedAmount += amount;
      summary.capturedCount++;
      if (transaction.status === "received") {
        summary.reviewCount++;
        summary.reviewAmount += amount;
      } else if (transaction.status === "approved") {
        summary.approvedCount++;
      } else if (transaction.status === "rejected") {
        summary.rejectedCount++;
      }
      return summary;
    },
    {
      capturedAmount: 0,
      capturedCount: 0,
      reviewAmount: 0,
      reviewCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
    },
  );
}

export function filterPaymentRows<T extends PaymentReportRow>(
  payments: T[],
  {
    search,
    status,
    from,
    to,
  }: {
    search: string;
    status: string;
    from: string;
    to: string;
  },
): T[] {
  const query = search.trim().toLowerCase();
  const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;

  return payments.filter((payment) => {
    if (status !== "all" && payment.status !== status) return false;
    const created = new Date(payment.created_at).getTime();
    if (!Number.isFinite(created) || created < fromTime || created > toTime) return false;
    if (!query) return true;
    return [payment.phone, payment.mpesa_receipt, payment.voucher_code].some((value) =>
      value?.toLowerCase().includes(query),
    );
  });
}

function csvCell(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  const safeText = /^[\t\r=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export function buildPaymentCsv(payments: PaymentReportRow[]): string {
  const header = ["Date", "Phone", "Amount (KES)", "M-Pesa receipt", "Voucher", "Status"];
  const rows = payments.map((payment) => [
    new Date(payment.created_at).toISOString(),
    payment.phone,
    Number(payment.amount).toFixed(2),
    payment.mpesa_receipt,
    payment.voucher_code,
    payment.status,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
