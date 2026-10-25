// IntaSend helpers that need no environment or database, so they can be unit-tested.
// API reference: https://developers.intasend.com/guides/collections/mpesa-stk-push/
//                https://developers.intasend.com/guides/webhooks/

export type InvoiceVerdict = "paid" | "failed" | "pending";

export interface IntasendInvoice {
  invoiceId: string;
  /** PENDING, PROCESSING, RETRY, PARTIAL, COMPLETE, FAILED or CANCELED (upper-cased). */
  state: string;
  value: number | null;
  currency: string | null;
  /** Our reference: the payment id we sent as api_ref. */
  apiRef: string | null;
  /** M-Pesa receipt number once paid. */
  receipt: string | null;
  failedReason: string | null;
  failedCode: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Reads an invoice from an API response ({ invoice: {...} }) or a webhook body (the invoice
 * fields at the top level). Webhook amounts are strings, API amounts are numbers; both parse.
 */
export function parseInvoice(json: unknown): IntasendInvoice | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const inv = (root.invoice && typeof root.invoice === "object" ? root.invoice : root) as Record<
    string,
    unknown
  >;
  const invoiceId = str(inv.invoice_id);
  const state = str(inv.state);
  if (!invoiceId || !state) return null;
  return {
    invoiceId,
    state: state.toUpperCase(),
    value: num(inv.value),
    currency: str(inv.currency),
    apiRef: str(inv.api_ref),
    receipt: str(inv.mpesa_reference) ?? str(inv.provider_ref),
    failedReason: str(inv.failed_reason),
    failedCode: str(inv.failed_code),
  };
}

/** COMPLETE is the only paid state. RETRY / PARTIAL / PROCESSING stay pending: more may come. */
export function invoiceVerdict(state: string): InvoiceVerdict {
  const s = state.toUpperCase();
  if (s === "COMPLETE") return "paid";
  if (s === "FAILED" || s === "CANCELED" || s === "CANCELLED") return "failed";
  return "pending";
}

/** STK Push amounts are whole shillings; IntaSend rounds up, so we send the same figure. */
export function intasendChargeAmount(amount: number): number {
  return Math.max(1, Math.ceil(amount));
}

export type PaidCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        "reference_mismatch" | "invoice_mismatch" | "currency" | "amount_missing" | "underpaid";
    };

/**
 * Before releasing a voucher, make sure the PAID invoice really is for this payment and amount.
 * (IntaSend's own guidance: match api_ref and check value and currency.)
 */
export function checkPaidInvoice(
  inv: IntasendInvoice,
  expected: { paymentId: string; invoiceId: string; amount: number },
): PaidCheck {
  if (inv.apiRef !== expected.paymentId) return { ok: false, reason: "reference_mismatch" };
  if (inv.invoiceId !== expected.invoiceId) return { ok: false, reason: "invoice_mismatch" };
  if (inv.currency && inv.currency.toUpperCase() !== "KES")
    return { ok: false, reason: "currency" };
  if (inv.value === null) return { ok: false, reason: "amount_missing" };
  if (inv.value < intasendChargeAmount(expected.amount)) return { ok: false, reason: "underpaid" };
  return { ok: true };
}

/** Constant-time string compare for the webhook challenge. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** "test" / "live" from the secret key prefix (ISSecretKey_test_… / ISSecretKey_live_…). */
export function intasendKeyMode(secretKey: string | undefined | null): "test" | "live" | null {
  if (!secretKey) return null;
  if (secretKey.startsWith("ISSecretKey_test_")) return "test";
  if (secretKey.startsWith("ISSecretKey_live_")) return "live";
  return null;
}
