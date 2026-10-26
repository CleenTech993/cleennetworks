// IntaSend M-Pesa STK Push (server only). Credentials come from Super admin -> Platform Payments (stored
// encrypted, see gateway-secrets.server.ts) or, as a fallback, from server environment variables:
//   INTASEND_SECRET_KEY         ISSecretKey_test_… (sandbox) or ISSecretKey_live_… (live)
//   INTASEND_WEBHOOK_CHALLENGE  the "Challenge" string set on the webhook in the IntaSend dashboard
//   INTASEND_BASE_URL           optional override. By default the key picks the server: test keys use
//                               https://sandbox.intasend.com, live keys use https://payment.intasend.com
import { gatewaySecret, loadGatewaySecrets } from "./gateway-secrets.server";
import {
  intasendBaseUrl,
  intasendChargeAmount,
  intasendEnvironment,
  parseInvoice,
  type IntasendEnvironment,
  type IntasendInvoice,
} from "./intasend";

const baseUrl = () =>
  intasendBaseUrl(gatewaySecret("INTASEND_SECRET_KEY"), process.env["INTASEND_BASE_URL"]);

export function intasendConfigured(): boolean {
  return !!gatewaySecret("INTASEND_SECRET_KEY");
}

function authHeaders(): Record<string, string> {
  const key = gatewaySecret("INTASEND_SECRET_KEY");
  if (!key) throw new Error("Payment gateway is not configured.");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function post(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; text: string; json: unknown }> {
  await loadGatewaySecrets();
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep raw text for the log */
  }
  return { ok: res.ok, status: res.status, text, json };
}

/** Sends the M-Pesa prompt. `reference` (our payment id) comes back as api_ref on the invoice and webhooks. */
export async function intasendStkPush(p: {
  amount: number;
  /** 2547XXXXXXXX / 2541XXXXXXXX */
  phone: string;
  reference: string;
}): Promise<{ invoiceId: string; state: string }> {
  // IntaSend's SDKs send the publishable ("API") key with M-Pesa collection requests; the secret key
  // goes in the Authorization header. The API key is optional here and only added when it is set.
  const publicKey = gatewaySecret("INTASEND_PUBLISHABLE_KEY");
  const r = await post("/api/v1/payment/mpesa-stk-push/", {
    amount: intasendChargeAmount(p.amount),
    phone_number: p.phone,
    api_ref: p.reference,
    ...(publicKey ? { public_key: publicKey } : {}),
  });
  const invoice = r.ok ? parseInvoice(r.json) : null;
  if (!invoice) {
    // The body can echo account details, so it goes to the server log only, never to the customer.
    console.error(`IntaSend STK failed [${r.status}]: ${r.text.slice(0, 500)}`);
    throw new Error("Could not send the M-Pesa prompt. Please try again.");
  }
  return { invoiceId: invoice.invoiceId, state: invoice.state };
}

/** Asks IntaSend directly for an invoice's true state (we never trust a webhook body on its own). */
export async function intasendInvoiceStatus(
  invoiceId: string,
): Promise<{ invoice: IntasendInvoice; raw: unknown }> {
  const r = await post("/api/v1/payment/status/", { invoice_id: invoiceId });
  const invoice = r.ok ? parseInvoice(r.json) : null;
  if (!invoice) throw new Error(`IntaSend status failed [${r.status}]: ${r.text.slice(0, 300)}`);
  return { invoice, raw: r.json };
}

export type KeyCheck = {
  result: "accepted" | "rejected" | "unreachable" | "not_set";
  /** Which IntaSend server the key was tried against: sandbox for test keys, live for live keys. */
  environment?: IntasendEnvironment;
};

/**
 * Asks IntaSend whether the stored secret key is accepted, without creating anything: it requests the
 * status of an invoice that does not exist. A bad key is refused outright (401/403); a good key gets a
 * normal "no such invoice" style answer. The response body is never returned (it can echo account data).
 */
export async function intasendCheckKey(): Promise<KeyCheck> {
  await loadGatewaySecrets({ force: true });
  const key = gatewaySecret("INTASEND_SECRET_KEY");
  if (!key) return { result: "not_set" };
  const environment = intasendEnvironment(key);
  try {
    const r = await post("/api/v1/payment/status/", { invoice_id: "00000000-connection-test" });
    if (r.status === 401 || r.status === 403) return { result: "rejected", environment };
    if (r.status >= 500) return { result: "unreachable", environment };
    return { result: "accepted", environment };
  } catch {
    return { result: "unreachable", environment };
  }
}
