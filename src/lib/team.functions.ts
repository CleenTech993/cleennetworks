import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Tenant admins manage their own team here; super admins no longer have to approve
// every technician. Roles a tenant admin may hand out are limited to tenant-level ones
// (never super_admin / end_user).
export const TEAM_ROLES = ["tenant_admin", "technician", "billing_agent", "support_staff"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export type TeamMember = {
  id: string;
  email: string | null;
  full_name: string | null;
  roles: TeamRole[];
  created_at: string | null;
};

type Fail = { ok: false; error: string };

/**
 * The caller's tenant, taken from their tenant_admin ROLE row. We deliberately do not
 * use profiles.tenant_id: users can edit their own profile, but only super admins (and
 * these server functions) can write user_roles.
 */
async function adminTenantOf(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "tenant_admin")
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.tenant_id ?? null;
}

const NOT_ADMIN: Fail = { ok: false, error: "Only tenant admins can manage the team." };

async function isMemberOf(tenantId: string, userId: string) {
  const { count } = await supabaseAdmin
    .from("user_roles")
    .select("user_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}

export const listTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true; members: TeamMember[] } | Fail> => {
    const tenantId = await adminTenantOf(context.userId);
    if (!tenantId) return NOT_ADMIN;

    const { data: roleRows, error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id,role")
      .eq("tenant_id", tenantId);
    if (error) return { ok: false, error: error.message };

    const ids = [...new Set((roleRows ?? []).map((r) => r.user_id))];
    if (ids.length === 0) return { ok: true, members: [] };

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id,email,full_name,created_at")
      .in("id", ids);

    const members: TeamMember[] = ids.map((id) => {
      const p = profiles?.find((x) => x.id === id);
      return {
        id,
        email: p?.email ?? null,
        full_name: p?.full_name ?? null,
        created_at: p?.created_at ?? null,
        roles: (roleRows ?? []).filter((r) => r.user_id === id).map((r) => r.role as TeamRole),
      };
    });
    members.sort((a, b) => (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""));
    return { ok: true, members };
  });

const AddSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(1).max(100),
  role: z.enum(TEAM_ROLES),
  password: z.string().min(8).max(72),
});

export const addTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => AddSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; existing: boolean } | Fail> => {
    const tenantId = await adminTenantOf(context.userId);
    if (!tenantId) return NOT_ADMIN;

    // Did this person already sign up on their own (and is still waiting for approval)?
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", data.email)
      .maybeSingle();

    let userId: string;
    let created = false;

    if (existing) {
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", existing.id);
      if ((count ?? 0) > 0) {
        return { ok: false, error: "That email already belongs to another account on the platform." };
      }
      userId = existing.id; // pending self-signup: attach them, keep their own password
    } else {
      const { data: res, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
      if (error || !res.user) return { ok: false, error: error?.message ?? "Could not create the account." };
      userId = res.user.id;
      created = true;
    }

    const rollback = async () => {
      if (created) await supabaseAdmin.auth.admin.deleteUser(userId);
    };

    // The signup trigger creates the profile; make sure it exists, then attach it to the tenant.
    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, email: data.email, full_name: data.fullName, tenant_id: tenantId }, { onConflict: "id" });
    if (pErr) {
      await rollback();
      return { ok: false, error: pErr.message };
    }

    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: data.role, tenant_id: tenantId });
    if (rErr) {
      await rollback();
      return { ok: false, error: rErr.message };
    }

    return { ok: true, existing: !created };
  });

const RoleSchema = z.object({ userId: z.string().uuid(), role: z.enum(TEAM_ROLES) });

export const updateTeamMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => RoleSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | Fail> => {
    const tenantId = await adminTenantOf(context.userId);
    if (!tenantId) return NOT_ADMIN;
    if (data.userId === context.userId) return { ok: false, error: "You can't change your own role." };
    if (!(await isMemberOf(tenantId, data.userId))) return { ok: false, error: "Member not found." };

    const { error: dErr } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", data.userId);
    if (dErr) return { ok: false, error: dErr.message };

    const { error: iErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role, tenant_id: tenantId });
    if (iErr) return { ok: false, error: iErr.message };
    return { ok: true };
  });

const RemoveSchema = z.object({ userId: z.string().uuid() });

export const removeTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => RemoveSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | Fail> => {
    const tenantId = await adminTenantOf(context.userId);
    if (!tenantId) return NOT_ADMIN;
    if (data.userId === context.userId) return { ok: false, error: "You can't remove yourself." };
    if (!(await isMemberOf(tenantId, data.userId))) return { ok: false, error: "Member not found." };

    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", data.userId);
    if (error) return { ok: false, error: error.message };

    // Detach from the tenant; with no roles left they land on the "pending" page if they sign in.
    await supabaseAdmin.from("profiles").update({ tenant_id: null }).eq("id", data.userId).eq("tenant_id", tenantId);
    return { ok: true };
  });
