import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import {
  checkSecretStore,
  deleteGatewaySecret,
  gatewaySecret,
  gatewaySecretStatus,
  loadGatewaySecrets,
  saveGatewaySecret,
} from "@/lib/gateway-secrets.server";
import { intasendKeyMode } from "@/lib/intasend";
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
  const challenge = gatewaySecretStatus("INTASEND_WEBHOOK_CHALLENGE");
  return {
    effective,
    /** "ok", or why saving credentials will fail (table missing / not permitted). */
    storage: await checkSecretStore(),
    payhero: payheroConfigured(),
    intasend: {
      secretKey: key.set,
      mode: intasendKeyMode(gatewaySecret("INTASEND_SECRET_KEY")),
      webhookChallenge: challenge.set,
      key,
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

// IntaSend secret keys look like ISSecretKey_test_<id> / ISSecretKey_live_<id>.
const KEY_RE = /^ISSecretKey_(test|live)_[A-Za-z0-9_-]{8,}$/;
// The webhook "challenge" is a shared string you choose: printable, no spaces, long enough to be unguessable.
const CHALLENGE_RE = /^[\x21-\x7e]{12,128}$/;

const SaveSchema = z
  .object({
    secretKey: z.string().trim().optional(),
    webhookChallenge: z.string().trim().optional(),
  })
  .refine((v) => v.secretKey || v.webhookChallenge, {
    message: "Enter a secret key or a webhook challenge.",
  });

export const saveIntasendCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input) => SaveSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as unknown as Ctx);
    if (data.secretKey && !KEY_RE.test(data.secretKey)) {
      throw new Error(
        "That does not look like an IntaSend secret key. It starts with ISSecretKey_test_ or ISSecretKey_live_.",
      );
    }
    if (data.webhookChallenge && !CHALLENGE_RE.test(data.webhookChallenge)) {
      throw new Error("The webhook challenge must be 12 to 128 characters with no spaces.");
    }
    if (data.secretKey)
      await saveGatewaySecret("INTASEND_SECRET_KEY", data.secretKey, context.userId);
    if (data.webhookChallenge)
      await saveGatewaySecret("INTASEND_WEBHOOK_CHALLENGE", data.webhookChallenge, context.userId);
    return buildStatus();
  });

const RemoveSchema = z.object({
  name: z.enum(["INTASEND_SECRET_KEY", "INTASEND_WEBHOOK_CHALLENGE"]),
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
