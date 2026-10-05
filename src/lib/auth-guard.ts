import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Client-side gate for console layouts: signed in + verified with OTP (aal2) + has a role. */
export async function requireConsole(opts: { superAdmin?: boolean } = {}) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw redirect({ to: "/login" });
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") throw redirect({ to: "/mfa" });
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
  if (!roles || roles.length === 0) throw redirect({ to: "/pending" });
  if (opts.superAdmin && !roles.some((r) => r.role === "super_admin")) throw redirect({ to: "/tenant" });
}
