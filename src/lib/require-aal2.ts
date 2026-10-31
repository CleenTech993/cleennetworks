import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAal2 } from "@/lib/aal";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Signed in AND verified with the one-time code (if MFA is activated by the admin).
 * If the admin chose to disable MFA, password authentication (aal1) is accepted.
 */
export const requireSupabaseAal2 = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    // If the token claims show aal2, the session is already fully verified
    if (isAal2(context.claims)) {
      return next();
    }

    // If claims are aal1, check if the user actually has an enrolled, verified MFA factor
    try {
      const { data } = await supabaseAdmin.auth.admin.mfa.listFactors({
        userId: context.userId,
      });
      const hasVerifiedMfa = data?.factors?.some((f) => f.status === "verified");
      // If the admin has MFA activated, they must pass the second factor
      if (hasVerifiedMfa) {
        throw new Error("Unauthorized: two-step verification required");
      }
    } catch (err: unknown) {
      if ((err as Error)?.message?.includes("two-step verification required")) {
        throw err;
      }
    }

    return next();
  });
