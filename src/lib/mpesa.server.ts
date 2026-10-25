// Server-only M-Pesa Daraja helpers. Centralized: one platform-level Daraja
// credential set, owned by Super Admin. Tenants only store receiving details
// (paybill / till / bank) for display + settlement.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadGatewaySecrets } from "@/lib/gateway-secrets.server";

export interface PlatformMpesaConfig {
  mpesa_env: string;
  shortcode: string | null;
  consumer_key: string | null;
  consumer_secret: string | null;
  passkey: string | null;
  callback_base_url: string | null;
  /** Which gateway new payments use: "intasend" (default) or "payhero". */
  active_provider: string;
}

export interface TenantReceiving {
  id: string;
  name: string;
  slug: string;
  mpesa_paybill: string | null;
  mpesa_till: string | null;
}

// Payment gateway: PayHero (https://payhero.co.ke). Credentials live in
// server secrets PAYHERO_API_USERNAME / PAYHERO_API_PASSWORD / PAYHERO_CHANNEL_ID.
export const PAYHERO_BASE = "https://backend.payhero.co.ke/api/v2";

/** True when the PayHero server secrets are all present. */
export function payheroConfigured(): boolean {
  return !!(
    process.env["PAYHERO_API_USERNAME"] &&
    process.env["PAYHERO_API_PASSWORD"] &&
    process.env["PAYHERO_CHANNEL_ID"]
  );
}

export function payheroAuthHeader(): string {
  const user = process.env["PAYHERO_API_USERNAME"];
  const pass = process.env["PAYHERO_API_PASSWORD"];
  if (!user || !pass) throw new Error("Payment gateway is not configured.");
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

export async function loadPlatformMpesaConfig(): Promise<PlatformMpesaConfig> {
  // Dashboard-entered gateway secrets must be loaded before resolveProvider() looks for them.
  await loadGatewaySecrets();
  const { data, error } = await supabaseAdmin
    .from("platform_mpesa_config")
    .select(
      "mpesa_env,shortcode,consumer_key,consumer_secret,passkey,callback_base_url,active_provider",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) console.error("loadPlatformMpesaConfig failed", error.message);
  return (data ?? {
    mpesa_env: "production",
    shortcode: null,
    consumer_key: null,
    consumer_secret: null,
    passkey: null,
    callback_base_url: null,
    active_provider: "intasend",
  }) as PlatformMpesaConfig;
}

export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  return digits;
}

interface StkPushParams {
  cfg: PlatformMpesaConfig;
  amount: number;
  phone: string;
  /** Our payment id — sent as PayHero external_reference. */
  reference: string;
  description: string;
  callbackUrl: string;
  customerName?: string;
}

export interface StkPushResult {
  CheckoutRequestID: string;
  /** PayHero transaction reference (used for status verification). */
  MerchantRequestID: string;
  CustomerMessage: string;
}

export async function stkPush(p: StkPushParams): Promise<StkPushResult> {
  const channelId = Number(process.env["PAYHERO_CHANNEL_ID"]);
  if (!channelId) throw new Error("Payment gateway channel is not configured.");
  const res = await fetch(`${PAYHERO_BASE}/payments`, {
    method: "POST",
    headers: { Authorization: payheroAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: Math.max(1, Math.round(p.amount)),
      phone_number: normalizePhone(p.phone),
      channel_id: channelId,
      provider: "m-pesa",
      external_reference: p.reference,
      customer_name: p.customerName ?? p.description,
      callback_url: p.callbackUrl,
    }),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  if (!res.ok || json.success === false) {
    console.error(`PayHero STK failed [${res.status}]: ${text}`);
    throw new Error(
      (json.error_message as string) ?? (json.message as string) ?? "Could not send M-Pesa prompt",
    );
  }
  return {
    CheckoutRequestID: String(json.CheckoutRequestID ?? ""),
    MerchantRequestID: String(json.reference ?? ""),
    CustomerMessage: "Check your phone for the M-Pesa prompt",
  };
}

/** Ask PayHero directly for the true status of a transaction. */
export async function payheroTransactionStatus(
  reference: string,
): Promise<{ status: string; receipt: string | null; raw: unknown }> {
  const res = await fetch(
    `${PAYHERO_BASE}/transaction-status?reference=${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: payheroAuthHeader() },
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`PayHero status failed [${res.status}]: ${text}`);
  const json = JSON.parse(text) as Record<string, unknown>;
  return {
    status: String(json.status ?? "").toUpperCase(),
    receipt: (json.provider_reference as string) ?? null,
    raw: json,
  };
}

export async function loadTenantBySlugAdmin(slug: string): Promise<TenantReceiving> {
  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id,name,slug,mpesa_paybill,mpesa_till")
    .eq("slug", slug)
    .single();
  if (error || !data) throw new Error("Portal not found");
  return data as TenantReceiving;
}

export function randomVoucher(): string {
  // Vouchers are bearer credentials: use a CSPRNG with rejection sampling (no modulo bias).
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const limit = 256 - (256 % chars.length);
  let out = "";
  while (out.length < 10) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && out.length < 10) out += chars[b % chars.length];
    }
  }
  return out;
}

export { expiryFrom } from "./duration";
