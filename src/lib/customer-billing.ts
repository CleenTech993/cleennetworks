export type CustomerInvoiceStatus = "pending" | "overdue" | "partial" | "paid" | "void";

export type AgingBucket = "current" | "0-7" | "7-30" | "30-plus";

export interface InvoiceBalanceInput {
  amount: number | string | null | undefined;
  paidAmount?: number | string | null;
  adjustmentAmount?: number | string | null;
  dueAt?: string | Date | null;
  now?: string | Date | number | null;
}

export function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

export function calculateOpenBalance({
  amount,
  paidAmount = 0,
  adjustmentAmount = 0,
}: Pick<InvoiceBalanceInput, "amount" | "paidAmount" | "adjustmentAmount">): number {
  const base = toNumber(amount);
  const paid = toNumber(paidAmount);
  const adjustments = toNumber(adjustmentAmount);
  return Math.max(base + adjustments - paid, 0);
}

export function invoiceStatusForBalance({
  amount,
  paidAmount = 0,
  adjustmentAmount = 0,
  dueAt,
  now,
}: InvoiceBalanceInput): CustomerInvoiceStatus {
  const total = Math.max(toNumber(amount) + toNumber(adjustmentAmount), 0);
  if (total <= 0) return "void";

  const paid = toNumber(paidAmount);
  if (paid >= total) return "paid";
  if (paid > 0) return "partial";

  if (dueAt) {
    const dueMs = new Date(dueAt).getTime();
    const when = now === undefined ? Date.now() : new Date(now).getTime();
    if (Number.isFinite(dueMs) && dueMs <= when) return "overdue";
  }

  return "pending";
}

export function invoiceAgingBucket({
  dueAt,
  now,
}: Pick<InvoiceBalanceInput, "dueAt" | "now">): AgingBucket {
  if (!dueAt) return "current";
  const dueMs = new Date(dueAt).getTime();
  if (!Number.isFinite(dueMs)) return "current";

  const when = now === undefined ? Date.now() : new Date(now).getTime();
  const diffDays = Math.ceil((when - dueMs) / 86_400_000);

  if (diffDays <= 0) return "current";
  if (diffDays <= 7) return "0-7";
  if (diffDays <= 30) return "7-30";
  return "30-plus";
}
