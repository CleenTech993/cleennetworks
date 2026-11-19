import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function tenantServiceRestriction(
  tenantId: string,
): Promise<"tenant_suspended" | "commission_overdue" | null> {
  const { data: tenant, error } = await supabaseAdmin
    .from("tenants")
    .select("status,billing_suspended_at")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!tenant) throw new Error("Tenant not found.");
  if (tenant.status === "suspended") return "tenant_suspended";
  if (tenant.billing_suspended_at) return "commission_overdue";
  return null;
}

export function tenantServiceRestrictionMessage(
  restriction: "tenant_suspended" | "commission_overdue",
): string {
  return restriction === "commission_overdue"
    ? "This tenant's customer service is paused because its platform commission invoice is overdue."
    : "This tenant's customer service is currently suspended.";
}
