import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WorkOrderAssignee = {
  id: string;
  name: string;
};

export const listWorkOrderAssignees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: unknown) => z.object({ tenantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<WorkOrderAssignee[]> => {
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("user_roles")
      .select("tenant_id")
      .eq("user_id", context.userId)
      .eq("tenant_id", data.tenantId)
      .in("role", ["tenant_admin", "technician"])
      .not("tenant_id", "is", null)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      console.error("Could not verify work order team access", membershipError);
      throw new Error("Could not load technicians.");
    }
    if (!membership?.tenant_id) return [];

    const { data: roleRows, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", membership.tenant_id)
      .in("role", ["tenant_admin", "technician"]);
    if (rolesError) {
      console.error("Could not load work order team roles", rolesError);
      throw new Error("Could not load technicians.");
    }

    const userIds = [...new Set((roleRows ?? []).map((row) => row.user_id))];
    if (!userIds.length) return [];

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id,first_name,last_name,full_name,email")
      .in("id", userIds);
    if (profilesError) {
      console.error("Could not load work order team profiles", profilesError);
      throw new Error("Could not load technicians.");
    }

    return (profiles ?? [])
      .map((profile) => ({
        id: profile.id,
        name:
          [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
          profile.full_name ||
          profile.email ||
          "Team member",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
