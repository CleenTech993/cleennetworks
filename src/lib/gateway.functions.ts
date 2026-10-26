import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import {
  deleteGatewaySecret,
  gatewaySecret,
  gatewaySecretStatus,
  loadGatewaySecrets,
  saveGatewaySecret,
} from "@/lib/gateway-secrets.server";
import { checkIntasendCredentials, intasendKeyMode } from "@/lib/intasend";
import { sweepPendingIntasendPayments } from "@/lib/intasend-reconcile.server";
import { intasendCheckKey } from "@/lib/intasend.server";
import { loadPlatformMpesaConfig, payheroConfigured } from "@/lib/mpesa.server";
import { resolveProvider } from "@/lib/payment-gateway.server";

type Ctx = { supabase: { from: (t: string) => any }; userId: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function assertSuperAdmin(context: Ctx): Promise<void> {
  const { data: roles } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  if (!(roles as { role: string }[] | null)?.some((r) => r.role === "super_admin"))
    throw new Error("Forbidden");
}

/** Shape sent to the dashboard. Only yes/no, last 4 characters, test/live and where it came from: never a key. */
async function buildStatus() {
  await loadGatewaySecrets({ force: true });
  // The gateway checkouts would really use right now (falls back if the selected one has no secrets).
  let effective: "payhero" | "intasend" | null = null;
  try {
    effective = resolveProvider(await loadPlatformMpesaConfig());
  } catch {
    effective = null;
  }
  const key = gatewaySecretStatus("INTASEND_SECRET_KEY");
  const pub = gatewaySecretStatus("INTASEND_PUBLISHABLE_KEY");
  const challenge = gatewaySecretStatus("INTASEND_WEBHOOK_CHALLENGE");
  return {
    effective,
    payhero: payheroConfigured(),
    intasend: {
      secretKey: key.set,
      mode: intasendKeyMode(gatewaySecret("INTASEND_SECRET_KEY")),
      webhookChallenge: challenge.set,
      key,
      pub,
      challenge,
    },
  };
}
export type GatewayStatus = Awaited<ReturnType<typeof buildStatus>>;

export const getGatewayStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context as unknown as Ctx);
    return buildStatus();
  });

const SaveSchema = z
  .object({
    secretKey: z.string().trim().optional(),
    publishableKey: z.string().trim().optional(),
    webhookChallenge: z.string().trim().optional(),
  })
  .refine((v) => v.secretKey || v.publishableKey || v.webhookChallenge, {
    message: "Enter at least one key to save.",
  });

export const saveIntasendCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input) => SaveSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as unknown as Ctx);
    await loadGatewaySecrets({ force: true });
    // Checks formats, and that the secret key and API key are both test or both live (also against
    // whichever one is already saved when only one is being changed).
    const problem = checkIntasendCredentials(data, {
      secretKey: gatewaySecret("INTASEND_SECRET_KEY"),
      publishableKey: gatewaySecret("INTASEND_PUBLISHABLE_KEY"),
    });
    if (problem) throw new Error(problem);
    if (data.secretKey)
      await saveGatewaySecret("INTASEND_SECRET_KEY", data.secretKey, context.userId);
    if (data.publishableKey) {
      await saveGatewaySecret("INTASEND_PUBLISHABLE_KEY", data.publishableKey, context.userId);
    }
    if (data.webhookChallenge) {
      await saveGatewaySecret("INTASEND_WEBHOOK_CHALLENGE", data.webhookChallenge, context.userId);
    }
    return buildStatus();
  });

const RemoveSchema = z.object({
  name: z.enum(["INTASEND_SECRET_KEY", "INTASEND_PUBLISHABLE_KEY", "INTASEND_WEBHOOK_CHALLENGE"]),
});

/** Removes the dashboard-entered value; an INTASEND_* environment variable, if any, applies again. */
export const removeIntasendCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input) => RemoveSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as unknown as Ctx);
    await deleteGatewaySecret(data.name);
    return buildStatus();
  });

export const testIntasendConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context as unknown as Ctx);
    return intasendCheckKey();
  });

/**
 * "Check pending payments now": asks IntaSend about recent payments still waiting for confirmation and
 * settles the paid ones. This is also what runs quietly in the background, so it is safe to press.
 */
export const checkPendingIntasendPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context as unknown as Ctx);
    return sweepPendingIntasendPayments({ limit: 25, minAgeSec: 0 });
  });
