export interface PaymentReportRow {
  id: string;
  created_at: string;
  phone: string | null;
  amount: number;
  mpesa_receipt: string | null;
  voucher_code: string | null;
  status: string;
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
