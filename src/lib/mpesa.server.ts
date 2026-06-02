// Server-only M-Pesa Daraja helpers. Never import from client code.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface TenantMpesa {
  id: string;
  mpesa_env: string;
  mpesa_shortcode: string | null;
  mpesa_paybill: string | null;
  mpesa_till: string | null;
  mpesa_consumer_key: string | null;
  mpesa_consumer_secret: string | null;
  mpesa_passkey: string | null;
}

export function darajaBase(env: string) {
  return env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

export async function getDarajaToken(t: TenantMpesa): Promise<string> {
  if (!t.mpesa_consumer_key || !t.mpesa_consumer_secret) {
    throw new Error("M-Pesa Daraja credentials are not configured for this tenant.");
  }
  const auth = btoa(`${t.mpesa_consumer_key}:${t.mpesa_consumer_secret}`);
  const res = await fetch(
    `${darajaBase(t.mpesa_env)}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Daraja returned no access_token");
  return json.access_token;
}

export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  return digits;
}

interface StkPushParams {
  tenant: TenantMpesa;
  amount: number;
  phone: string;
  reference: string;
  description: string;
  callbackUrl: string;
}

export interface StkPushResult {
  CheckoutRequestID: string;
  MerchantRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

export async function stkPush(p: StkPushParams): Promise<StkPushResult> {
  const shortcode = p.tenant.mpesa_shortcode ?? p.tenant.mpesa_paybill ?? p.tenant.mpesa_till;
  if (!shortcode) throw new Error("Tenant has no M-Pesa shortcode configured.");
  if (!p.tenant.mpesa_passkey) throw new Error("Tenant has no M-Pesa passkey configured.");

  const token = await getDarajaToken(p.tenant);
  const ts = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const password = btoa(`${shortcode}${p.tenant.mpesa_passkey}${ts}`);

  const body = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: ts,
    TransactionType: p.tenant.mpesa_paybill ? "CustomerPayBillOnline" : "CustomerBuyGoodsOnline",
    Amount: Math.max(1, Math.round(p.amount)),
    PartyA: normalizePhone(p.phone),
    PartyB: shortcode,
    PhoneNumber: normalizePhone(p.phone),
    CallBackURL: p.callbackUrl,
    AccountReference: p.reference.slice(0, 12),
    TransactionDesc: p.description.slice(0, 13),
  };

  const res = await fetch(`${darajaBase(p.tenant.mpesa_env)}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.ResponseCode !== "0") {
    throw new Error(json.errorMessage ?? json.ResponseDescription ?? "STK Push failed");
  }
  return json as StkPushResult;
}

export async function loadTenantByIdAdmin(tenantId: string): Promise<TenantMpesa> {
  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select(
      "id,mpesa_env,mpesa_shortcode,mpesa_paybill,mpesa_till,mpesa_consumer_key,mpesa_consumer_secret,mpesa_passkey",
    )
    .eq("id", tenantId)
    .single();
  if (error || !data) throw new Error("Tenant not found");
  return data as TenantMpesa;
}

export async function loadTenantBySlugAdmin(slug: string): Promise<TenantMpesa & { name: string; slug: string }> {
  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select(
      "id,name,slug,mpesa_env,mpesa_shortcode,mpesa_paybill,mpesa_till,mpesa_consumer_key,mpesa_consumer_secret,mpesa_passkey",
    )
    .eq("slug", slug)
    .single();
  if (error || !data) throw new Error("Portal not found");
  return data as TenantMpesa & { name: string; slug: string };
}

export function randomVoucher(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
