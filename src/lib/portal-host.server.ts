import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function resolvePortalHost(tenantId: string, fallbackHost: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("tenant_domains")
    .select("domain")
    .eq("tenant_id", tenantId)
    .eq("purpose", "hotspot")
    .not("verified_at", "is", null)
    .maybeSingle();

  if (error) {
    console.error("Verified hotspot domain lookup failed", error);
    return fallbackHost;
  }

  return data?.domain?.trim().toLowerCase() || fallbackHost;
}