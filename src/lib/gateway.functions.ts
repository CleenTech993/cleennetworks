import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { intasendKeyMode } from "@/lib/intasend";
import { loadPlatformMpesaConfig, payheroConfigured } from "@/lib/mpesa.server";
import { resolveProvider } from "@/lib/payment-gateway.server";

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
    // The gateway checkouts would really use right now (falls back if the selected one has no secrets).
    let effective: "payhero" | "intasend" | null = null;
    try {
      effective = resolveProvider(await loadPlatformMpesaConfig());
    } catch {
      effective = null;
    }
    return {
      effective,
      payhero: payheroConfigured(),
      intasend: {
        secretKey: !!env["INTASEND_SECRET_KEY"],
        mode: intasendKeyMode(env["INTASEND_SECRET_KEY"]),
        webhookChallenge: !!env["INTASEND_WEBHOOK_CHALLENGE"],
      },
    };
  });
