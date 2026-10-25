import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAal2 } from "@/lib/aal";

/**
 * Signed in AND verified with the one-time code. The browser redirects to /mfa, but that is only
 * UI; this makes the server refuse a password-only session too. Use it instead of
 * requireSupabaseAuth on every console server function.
 */
export const requireSupabaseAal2 = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    if (!isAal2(context.claims)) {
      throw new Error("Unauthorized: two-step verification required");
    }
    return next();
  });
