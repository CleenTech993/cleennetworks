// Shared M-Pesa helpers. Tenant-owned Daraja credentials and STK requests live in daraja.server.ts.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface TenantReceiving {
  id: string;
  name: string;
  slug: string;
}

export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  return digits;
}

export async function loadTenantBySlugAdmin(slug: string): Promise<TenantReceiving> {
  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id,name,slug")
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
