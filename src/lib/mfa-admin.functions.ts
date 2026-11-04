import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ResetMfaSchema = z.object({ userId: z.string().uuid() });

export const resetUserMfa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input: z.input<typeof ResetMfaSchema>) => ResetMfaSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (data.userId === context.userId) {
      throw new Error("You cannot reset your own MFA. Ask another administrator for help.");
    }

    const { data: actorRoles, error: actorRolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role,tenant_id")
      .eq("user_id", context.userId);
    if (actorRolesError) throw actorRolesError;

    const superAdmin = actorRoles?.some((role) => role.role === "super_admin") ?? false;
    const tenantIds = [
      ...new Set(
        (actorRoles ?? []).flatMap((role) =>
          role.role === "tenant_admin" && role.tenant_id ? [role.tenant_id] : [],
        ),
      ),
    ];
    if (!superAdmin && tenantIds.length === 0) {
      throw new Error("Only tenant admins and super admins can reset MFA.");
    }

    const { data: targetRoles, error: targetRolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role,tenant_id")
      .eq("user_id", data.userId);
    if (targetRolesError) throw targetRolesError;
    if (!targetRoles?.length)
      throw new Error("The selected account is not an active console user.");
    if (!superAdmin && targetRoles.some((role) => role.role === "super_admin")) {
      throw new Error("Only a super admin can reset another super admin's MFA.");
    }

    const sharedTenant = targetRoles.some(
      (role) => role.tenant_id && tenantIds.includes(role.tenant_id),
    );
    if (!superAdmin && !sharedTenant) {
      throw new Error("You can only reset MFA for users in your tenant.");
    }

    const { data: factors, error: factorsError } = await supabaseAdmin.auth.admin.mfa.listFactors({
      userId: data.userId,
    });
    if (factorsError) throw factorsError;
    if (factors.factors.length === 0) return { removed: 0 };

    let removed = 0;
    let deletionError: string | null = null;
    for (const factor of factors.factors) {
      const { error } = await supabaseAdmin.auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: data.userId,
      });
      if (error) {
        deletionError ??= error.message;
      } else {
        removed++;
      }
    }

    const tenantId = superAdmin
      ? (targetRoles.find((role) => role.tenant_id)?.tenant_id ?? null)
      : (tenantIds.find((id) => targetRoles.some((role) => role.tenant_id === id)) ?? null);
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: context.userId,
      actor_role: superAdmin ? "super_admin" : "tenant_admin",
      action: "reset_mfa",
      resource_type: "auth",
      resource_id: data.userId,
      description: "Administrator reset a user's MFA factors",
      metadata: {
        attempted_factors: factors.factors.length,
        removed_factors: removed,
      },
    });
    if (auditError) {
      throw new Error(
        `MFA reset removed ${removed} of ${factors.factors.length} factors, but the audit log could not be written: ${auditError.message}`,
      );
    }
    if (deletionError) {
      throw new Error(
        `MFA reset removed ${removed} of ${factors.factors.length} factors: ${deletionError}`,
      );
    }

    return { removed };
  });
