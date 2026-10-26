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

// ---- Credentials entered on the dashboard -------------------------------------------------------
/** Secret key: ISSecretKey_test_… / ISSecretKey_live_… */
export const INTASEND_SECRET_KEY_RE = /^ISSecretKey_(test|live)_[A-Za-z0-9_-]{8,}$/;
/** Publishable ("API") key: ISPubKey_test_… / ISPubKey_live_… */
export const INTASEND_PUBLIC_KEY_RE = /^ISPubKey_(test|live)_[A-Za-z0-9_-]{8,}$/;
/** Webhook challenge: a shared string you choose. Printable, no spaces, long enough to be unguessable. */
export const INTASEND_CHALLENGE_RE = /^[\x21-\x7e]{12,128}$/;

/** "test" / "live" from the publishable key prefix. */
export function intasendPublicKeyMode(key: string | undefined | null): "test" | "live" | null {
  if (!key) return null;
  if (key.startsWith("ISPubKey_test_")) return "test";
  if (key.startsWith("ISPubKey_live_")) return "live";
  return null;
}

/**
 * Checks what a super admin is about to save. Returns a message for the first problem, or null.
 * `existing` is what is already stored (or set in the environment), so changing only ONE key of the
 * pair is still checked against the other: a test secret key with a live API key (or the reverse) is
 * the classic setup mistake and makes every payment fail.
 */
export function checkIntasendCredentials(
  input: { secretKey?: string; publishableKey?: string; webhookChallenge?: string },
  existing: { secretKey?: string | null; publishableKey?: string | null } = {},
): string | null {
  if (input.secretKey && !INTASEND_SECRET_KEY_RE.test(input.secretKey)) {
    return "That does not look like an IntaSend secret key. It starts with ISSecretKey_test_ or ISSecretKey_live_.";
  }
  if (input.publishableKey && !INTASEND_PUBLIC_KEY_RE.test(input.publishableKey)) {
    return "That does not look like an IntaSend API (publishable) key. It starts with ISPubKey_test_ or ISPubKey_live_.";
  }
  if (input.webhookChallenge && !INTASEND_CHALLENGE_RE.test(input.webhookChallenge)) {
    return "The webhook challenge must be 12 to 128 characters with no spaces.";
  }
  const secretMode = intasendKeyMode(input.secretKey ?? existing.secretKey);
  const publicMode = intasendPublicKeyMode(input.publishableKey ?? existing.publishableKey);
  if (secretMode && publicMode && secretMode !== publicMode) {
    return `Your secret key is a ${secretMode} key but your API key is a ${publicMode} key. Use two ${secretMode} keys or two ${publicMode} keys from the same IntaSend environment.`;
  }
  return null;
}

export type IntasendEnvironment = "sandbox" | "live";

/**
 * IntaSend runs two completely separate servers and a key only works on its own:
 *   test keys (ISSecretKey_test_…)  -> https://sandbox.intasend.com
 *   live keys (ISSecretKey_live_…)  -> https://payment.intasend.com
 * A test key sent to the live server (or the reverse) is simply refused. `override` (the optional
 * INTASEND_BASE_URL setting) wins when set, for proxies or future endpoint changes.
 */
export function intasendEnvironment(secretKey: string | undefined | null): IntasendEnvironment {
  return intasendKeyMode(secretKey) === "test" ? "sandbox" : "live";
}

export function intasendBaseUrl(
  secretKey: string | undefined | null,
  override?: string | null,
): string {
  if (override) return override.replace(/\/$/, "");
  return intasendEnvironment(secretKey) === "sandbox"
    ? "https://sandbox.intasend.com"
    : "https://payment.intasend.com";
}
