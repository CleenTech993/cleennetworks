import type { Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

export interface LogAuditParams {
  tenantId?: string | null;
  action: string;
  /** Resource type, e.g. "router" or "pppoe_client". `resourceType` is the legacy alias. */
  resource?: string;
  resourceType?: string;
  resourceId?: string | null;
  /** Human-readable summary. Falls back to "<action> <resourceType>". */
  description?: string;
  /** Structured detail stored in audit_logs.metadata. `metadata` is the legacy alias. */
  details?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAudit({
  tenantId,
  action,
  resource,
  resourceType,
  resourceId,
  description,
  details,
  metadata,
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

    const rt = resource ?? resourceType ?? "system";
    const extra = (details ?? metadata ?? {}) as unknown as Json;

    await supabase.from("audit_logs").insert({
      tenant_id: tenantId ?? null,
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      actor_role: actorRole,
      action,
      resource_type: rt,
      resource_id: resourceId ?? null,
      description: description ?? `${action} ${rt}`,
      metadata: extra,
    });
  } catch (err: unknown) {
    console.warn("Failed to write audit log:", err);
  }
}
