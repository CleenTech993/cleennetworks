import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/permissions";

/** Client-side gate for console layouts: signed in + verified with OTP (aal2) + has a role. Returns the user's roles. */
export async function requireConsole(opts: { superAdmin?: boolean } = {}): Promise<AppRole[]> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw redirect({ to: "/login" });
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") throw redirect({ to: "/mfa" });
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
  if (!roles || roles.length === 0) throw redirect({ to: "/pending" });
  if (opts.superAdmin && !roles.some((r) => r.role === "super_admin")) throw redirect({ to: "/tenant" });
  return roles.map((r) => r.role as AppRole);
}
