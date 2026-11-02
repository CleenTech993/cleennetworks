import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAal2 } from "@/lib/aal";

/**
 * Signed in and verified with the one-time code.
 */
export const requireSupabaseAal2 = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    if (!isAal2(context.claims)) {
      throw new Error("Unauthorized: two-step verification required");
    }
    return next();
  });
