import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isStrongPassword } from "@/lib/password-policy";
import { generateTemporaryPassword, sendTeamCredentialsEmail } from "@/lib/team-invite.server";

// Tenant admins manage their own team here; super admins no longer have to approve
// every technician. Roles a tenant admin may hand out are limited to tenant-level ones
// (never super_admin / end_user).
export const TEAM_ROLES = ["tenant_admin", "technician", "billing_agent", "support_staff"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export type TeamMember = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
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
  .middleware([requireSupabaseAal2])
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

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id,email,first_name,last_name,full_name,phone,created_at")
      .in("id", ids);
    if (profileError) {
      console.error("Could not load team profiles", profileError);
      return { ok: false, error: "Could not load team member details. Please try again." };
    }

    const members: TeamMember[] = ids.map((id) => {
      const p = profiles?.find((x) => x.id === id);
      return {
        id,
        email: p?.email ?? null,
        first_name: p?.first_name ?? null,
        last_name: p?.last_name ?? null,
        full_name: p?.full_name ?? null,
        phone: p?.phone ?? null,
        created_at: p?.created_at ?? null,
        roles: (roleRows ?? []).filter((r) => r.user_id === id).map((r) => r.role as TeamRole),
      };
    });
    members.sort((a, b) =>
      (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""),
    );
    return { ok: true, members };
  });

const AddSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 ()-]{6,19}$/),
  roles: z
    .array(z.enum(TEAM_ROLES))
    .min(1)
    .max(TEAM_ROLES.length)
    .transform((roles) => [...new Set(roles)]),
});

export const addTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: unknown) => AddSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | Fail> => {
    const input = AddSchema.parse(data);
    const tenantId = await adminTenantOf(context.userId);
    if (!tenantId) return NOT_ADMIN;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", input.email)
      .maybeSingle();
    if (existingError) {
      console.error("Could not check for an existing team account", existingError);
      return { ok: false, error: "Could not check that email address. Please try again." };
    }
    if (existing)
      return {
        ok: false,
        error: "That email already has a NetGrid account. Use a different email address.",
      };

    const fullName = `${input.firstName} ${input.lastName}`;
    const temporaryPassword = generateTemporaryPassword();
    const { data: res, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: input.email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        first_name: input.firstName,
        last_name: input.lastName,
        full_name: fullName,
        phone: input.phone,
      },
      app_metadata: { must_change_password: true },
    });
    if (createError || !res.user) {
      console.error("Could not create team account", createError);
      return {
        ok: false,
        error: "Could not create the account. Check the email and try again.",
      };
    }

    const rollback = async (reason: string): Promise<Fail> => {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(res.user.id);
      if (error) console.error("Could not roll back incomplete team account", error);
      console.error(reason);
      return { ok: false, error: "Could not finish creating the team account. Please try again." };
    };

    const { error: pErr } = await supabaseAdmin.from("profiles").upsert(
      {
        id: res.user.id,
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
        full_name: fullName,
        phone: input.phone,
        tenant_id: tenantId,
      },
      { onConflict: "id" },
    );
    if (pErr) return rollback(`Could not create team profile: ${pErr.message}`);

    const { error: rErr } = await supabaseAdmin.from("user_roles").insert(
      input.roles.map((role) => ({
        user_id: res.user.id,
        role,
        tenant_id: tenantId,
      })),
    );
    if (rErr) return rollback(`Could not assign team roles: ${rErr.message}`);

    try {
      await sendTeamCredentialsEmail({
        recipient: input.email,
        firstName: input.firstName,
        email: input.email,
        temporaryPassword,
      });
    } catch (error) {
      return rollback(
        `Could not send team credentials to ${input.email}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { ok: true };
  });

const TemporaryPasswordSchema = z.object({
  password: z.string().min(8).max(72).refine(isStrongPassword),
});

export const changeTemporaryPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => TemporaryPasswordSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | Fail> => {
    const { data: result, error: lookupError } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );
    if (lookupError || !result.user) {
      console.error("Could not verify temporary-password account", lookupError);
      return { ok: false, error: "Could not verify your account. Please sign in again." };
    }
    if (result.user.app_metadata["must_change_password"] !== true) {
      return { ok: false, error: "This account does not require a temporary password change." };
    }

    const appMetadata = { ...result.user.app_metadata };
    delete appMetadata["must_change_password"];
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.password,
      app_metadata: appMetadata,
    });
    if (error) {
      console.error("Could not update temporary password", error);
      return { ok: false, error: "Could not update your password. Please try again." };
    }
    return { ok: true };
  });

const RoleSchema = z.object({
  userId: z.string().uuid(),
  roles: z
    .array(z.enum(TEAM_ROLES))
    .min(1)
    .max(TEAM_ROLES.length)
    .transform((roles) => [...new Set(roles)]),
});

export const updateTeamMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: unknown) => RoleSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | Fail> => {
    const input = RoleSchema.parse(data);
    const tenantId = await adminTenantOf(context.userId);
    if (!tenantId) return NOT_ADMIN;
    if (input.userId === context.userId)
      return { ok: false, error: "You can't change your own role." };
    if (!(await isMemberOf(tenantId, input.userId)))
      return { ok: false, error: "Member not found." };

    const { error } = await supabaseAdmin.rpc("update_tenant_member_roles", {
      p_actor_id: context.userId,
      p_user_id: input.userId,
      p_roles: input.roles,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  });

const RemoveSchema = z.object({ userId: z.string().uuid() });

export const removeTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: unknown) => RemoveSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | Fail> => {
    const input = RemoveSchema.parse(data);
    const tenantId = await adminTenantOf(context.userId);
    if (!tenantId) return NOT_ADMIN;
    if (input.userId === context.userId) return { ok: false, error: "You can't remove yourself." };
    const { error } = await supabaseAdmin.rpc("remove_tenant_member", {
      p_actor_id: context.userId,
      p_user_id: input.userId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  });
