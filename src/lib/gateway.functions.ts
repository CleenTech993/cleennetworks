import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { intasendKeyMode } from "@/lib/intasend";

/**
 * Which gateway secrets are present on the server, for the Platform Payments page.
 * Only yes/no (and test/live for IntaSend) is returned, never a key.
 */
export const getGatewayStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!roles?.some((r) => r.role === "super_admin")) throw new Error("Forbidden");

    const env = process.env;
    return {
      payhero: !!(
        env["PAYHERO_API_USERNAME"] &&
        env["PAYHERO_API_PASSWORD"] &&
        env["PAYHERO_CHANNEL_ID"]
      ),
      intasend: {
        secretKey: !!env["INTASEND_SECRET_KEY"],
        mode: intasendKeyMode(env["INTASEND_SECRET_KEY"]),
        webhookChallenge: !!env["INTASEND_WEBHOOK_CHALLENGE"],
      },
    };
  });
