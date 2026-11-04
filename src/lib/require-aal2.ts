import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAal2 } from "@/lib/aal";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Ensures caller is authorized:
 * - If MFA is enabled on their account: verified at aal2 (one-time code).
 * - If MFA is disabled on their account: standard authenticated session permitted.
 */
export const requireSupabaseAal2 = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    if (!isAal2(context.claims)) {
      // Check if user has an enrolled, verified MFA factor
      const { data: factors, error } = await supabaseAdmin.auth.admin.mfa.listFactors({
        userId: context.userId,
      });
      if (error) {
        console.error("Could not verify user MFA status", error);
        throw new Error("Could not verify authentication level");
      }
      const hasVerifiedMfa = factors?.factors?.some((f) => f.status === "verified");
      if (hasVerifiedMfa) {
        throw new Error("Unauthorized: two-step verification required");
      }
    }
    return next();
  });
