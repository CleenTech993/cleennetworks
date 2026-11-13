import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAal2 } from "@/lib/require-aal2";

const GrantSchema = z.object({
  tenantId: z.string().uuid(),
  staffUserId: z.string().uuid(),
  accessType: z.enum(["hotspot", "pppoe", "both"]),
  hotspotPackageId: z.string().uuid().optional(),
  pppoePackageId: z.string().uuid().optional(),
  routerId: z.string().uuid().optional(),
  pppoeUsername: z.string().trim().max(64).optional(),
  pppoePassword: z.string().max(64).optional(),
  note: z.string().trim().max(200).optional(),
});

export type StaffInternetGrantResult = {
  hotspot_grant_id: string | null;
  hotspot_code: string | null;
  pppoe_grant_id: string | null;
  pppoe_username: string | null;
  pppoe_password: string | null;
  expires_at: string;
};

function isGrantResult(value: unknown): value is StaffInternetGrantResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    (result["hotspot_grant_id"] === null || typeof result["hotspot_grant_id"] === "string") &&
    (result["hotspot_code"] === null || typeof result["hotspot_code"] === "string") &&
    (result["pppoe_grant_id"] === null || typeof result["pppoe_grant_id"] === "string") &&
    (result["pppoe_username"] === null || typeof result["pppoe_username"] === "string") &&
    (result["pppoe_password"] === null || typeof result["pppoe_password"] === "string") &&
    typeof result["expires_at"] === "string"
  );
}

export const grantStaffInternet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: unknown) => GrantSchema.parse(input))
  .handler(async ({ data, context }): Promise<StaffInternetGrantResult> => {
    const { data: role, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("tenant_id")
      .eq("user_id", context.userId)
      .eq("tenant_id", data.tenantId)
      .eq("role", "tenant_admin")
      .not("tenant_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (roleError) {
      console.error("Could not verify staff internet grant permission", roleError);
      throw new Error("Could not verify that you can grant staff internet.");
    }
    if (!role?.tenant_id) throw new Error("Only tenant administrators can grant staff internet.");

    if (data.accessType !== "pppoe" && !data.hotspotPackageId) {
      throw new Error("Choose a hotspot package.");
    }
    if (data.accessType !== "hotspot" && (!data.pppoePackageId || !data.routerId)) {
      throw new Error("Choose a PPPoE package and router.");
    }
    if (data.accessType !== "hotspot" && (!data.pppoeUsername || !data.pppoePassword)) {
      throw new Error("Enter the PPPoE username and password.");
    }

    const { data: result, error } = await supabaseAdmin.rpc("grant_staff_internet", {
      p_actor_id: context.userId,
      p_tenant_id: data.tenantId,
      p_staff_user_id: data.staffUserId,
      p_access_type: data.accessType,
      p_hotspot_package_id: data.hotspotPackageId ?? null,
      p_pppoe_package_id: data.pppoePackageId ?? null,
      p_router_id: data.routerId ?? null,
      p_pppoe_username: data.pppoeUsername ?? null,
      p_pppoe_password: data.pppoePassword ?? null,
      p_note: data.note ?? null,
    });
    if (error) {
      console.error("Could not grant staff internet", error);
      throw new Error(error.message || "Could not grant staff internet.");
    }
    if (!isGrantResult(result)) {
      console.error("Staff internet grant returned an invalid result.");
      throw new Error("The access was created, but its details could not be loaded.");
    }
    return result;
  });
