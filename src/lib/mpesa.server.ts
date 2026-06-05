// Server-only M-Pesa Daraja helpers. Centralized: one platform-level Daraja
// credential set, owned by Super Admin. Tenants only store receiving details
// (paybill / till / bank) for display + settlement.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface PlatformMpesaConfig {
  mpesa_env: string;
  shortcode: string | null;
  consumer_key: string | null;
  consumer_secret: string | null;
  passkey: string | null;
  callback_base_url: string | null;
}

export interface TenantReceiving {
  id: string;
  name: string;
  slug: string;
  mpesa_paybill: string | null;
  mpesa_till: string | null;
}

export function darajaBase(env: string) {
  return env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

export async function loadPlatformMpesaConfig(): Promise<PlatformMpesaConfig> {
  const { data, error } = await supabaseAdmin
    .from("platform_mpesa_config")
    .select("mpesa_env,shortcode,consumer_key,consumer_secret,passkey,callback_base_url")
    .eq("id", 1)
    .single();
  if (error || !data) throw new Error("Platform M-Pesa is not configured. Ask Super Admin to set credentials.");
  if (!data.consumer_key || !data.consumer_secret || !data.passkey || !data.shortcode) {
    throw new Error("Platform M-Pesa is not fully configured.");
  }
  return data as PlatformMpesaConfig;
}

export async function getDarajaToken(cfg: PlatformMpesaConfig): Promise<string> {
  const auth = btoa(`${cfg.consumer_key}:${cfg.consumer_secret}`);
  const res = await fetch(
    `${darajaBase(cfg.mpesa_env)}/oauth/v1/generate?grant_type=client_credentials`,
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
  cfg: PlatformMpesaConfig;
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
  const shortcode = p.cfg.shortcode!;
  const token = await getDarajaToken(p.cfg);
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const password = btoa(`${shortcode}${p.cfg.passkey}${ts}`);

  const body = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: ts,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.max(1, Math.round(p.amount)),
    PartyA: normalizePhone(p.phone),
    PartyB: shortcode,
    PhoneNumber: normalizePhone(p.phone),
    CallBackURL: p.callbackUrl,
    AccountReference: p.reference.slice(0, 12),
    TransactionDesc: p.description.slice(0, 13),
  };

  const res = await fetch(`${darajaBase(p.cfg.mpesa_env)}/mpesa/stkpush/v1/processrequest`, {
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
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function expiryFrom(value: number, unit: string): string {
  const ms =
    unit === "minute" ? value * 60_000 :
    unit === "hour"   ? value * 3_600_000 :
    unit === "day"    ? value * 86_400_000 :
    unit === "week"   ? value * 7 * 86_400_000 :
    unit === "month"  ? value * 30 * 86_400_000 :
    value * 86_400_000;
  return new Date(Date.now() + ms).toISOString();
}
