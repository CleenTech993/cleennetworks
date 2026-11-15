import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/permissions";

/** Client-side gate for console layouts: signed in + verified with OTP (aal2 if MFA enabled) + has a role. Returns the user's roles. */
export async function requireConsole(opts: { superAdmin?: boolean } = {}): Promise<AppRole[]> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const user = data.session?.user;
  if (!user) throw redirect({ to: "/login" });
  if (user.app_metadata["must_change_password"] === true) {
    throw redirect({ to: "/change-password" });
  }
  const { data: roles, error: rolesError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (rolesError) throw rolesError;
  if (!roles || roles.length === 0) throw redirect({ to: "/pending" });
  if (roles.some((r) => r.role === "demo_viewer") && opts.superAdmin) {
    throw redirect({ to: "/tenant" });
  }
  if (opts.superAdmin && !roles.some((r) => r.role === "super_admin"))
    throw redirect({ to: "/tenant" });

  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) throw factorsError;
  const hasVerifiedFactor = factors?.totp.some((factor) => factor.status === "verified") ?? false;
  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError) throw aalError;
  const isDemoViewer = roles.some((r) => r.role === "demo_viewer");
  if (!isDemoViewer && hasVerifiedFactor && aal?.currentLevel !== "aal2") {
    throw redirect({ to: "/mfa" });
  }

  return roles.map((r) => r.role as AppRole);
}
