import { supabase } from "@/integrations/supabase/client";

export interface LogAuditParams {
  tenantId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  description: string;
  metadata?: Record<string, unknown> | null;
}

export async function logAudit({
  tenantId,
  action,
  resourceType,
  resourceId,
  description,
  metadata = {},
}: LogAuditParams) {
  try {
    const { data: u } = await supabase.auth.getUser();
    const user = u.user;
    let actorRole = "system";

    if (user) {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (roles?.some((r) => r.role === "super_admin")) {
        actorRole = "super_admin";
      } else if (roles?.some((r) => r.role === "tenant_admin")) {
        actorRole = "tenant_admin";
      } else if (roles?.[0]?.role) {
        actorRole = roles[0].role;
      }
    }

    await supabase.from("audit_logs").insert({
      tenant_id: tenantId ?? null,
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      actor_role: actorRole,
      action,
      resource_type: resourceType,
      resource_id: resourceId ?? null,
      description,
      metadata: metadata as Record<string, unknown>,
    });
  } catch (err: unknown) {
    console.warn("Failed to write audit log:", err);
  }
}
