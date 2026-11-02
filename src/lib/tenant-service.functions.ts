import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  deleteTenantServiceSecrets,
  loadTenantServiceSecrets,
  saveTenantServiceSecret,
  type TenantServiceSecretName,
} from "@/lib/tenant-service-secrets.server";

async function tenantAdminId(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "tenant_admin")
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error || !data?.tenant_id)
    throw new Error("Only tenant admins can manage service credentials.");
  return data.tenant_id;
}

function emailLocalPart(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 64);
  return normalized || "business";
}

async function getStatus(tenantId: string) {
  const [secrets, tenantResult] = await Promise.all([
    loadTenantServiceSecrets(tenantId),
    supabaseAdmin.from("tenants").select("slug").eq("id", tenantId).single(),
  ]);
  if (tenantResult.error || !tenantResult.data) throw new Error("Tenant not found.");

  const domain = process.env["TENANT_EMAIL_DOMAIN"]?.trim().replace(/^@/, "") || "";
  const mpesaFields = [
    secrets.MPESA_SHORTCODE,
    secrets.MPESA_CONSUMER_KEY,
    secrets.MPESA_CONSUMER_SECRET,
    secrets.MPESA_PASSKEY,
  ];
  return {
    mpesaConfigured: mpesaFields.every(Boolean),
    mpesaEnvironment:
      (secrets.MPESA_ENV === "production" ? "production" : "sandbox") as "sandbox" | "production",
    shortcodeLast4: secrets.MPESA_SHORTCODE?.slice(-4) ?? null,
    smsConfigured: Boolean(secrets.AT_USERNAME && secrets.AT_API_KEY),
    smsSenderConfigured: Boolean(secrets.AT_SENDER_ID),
    emailAddress: domain ? `${emailLocalPart(tenantResult.data.slug)}@${domain}` : null,
  };
}

export type TenantServiceStatus = Awaited<ReturnType<typeof getStatus>>;

export const getTenantServiceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }) => getStatus(await tenantAdminId(context.userId)));

const SaveSchema = z
  .object({
    mpesaEnvironment: z.enum(["sandbox", "production"]).optional(),
    mpesaShortcode: z.string().trim().max(30).optional(),
    mpesaConsumerKey: z.string().trim().max(500).optional(),
    mpesaConsumerSecret: z.string().trim().max(500).optional(),
    mpesaPasskey: z.string().trim().max(500).optional(),
    smsUsername: z.string().trim().max(200).optional(),
    smsApiKey: z.string().trim().max(500).optional(),
    smsSenderId: z.string().trim().max(50).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry?.length), {
    message: "Enter at least one credential to save.",
  });

const FIELD_NAMES = {
  mpesaEnvironment: "MPESA_ENV",
  mpesaShortcode: "MPESA_SHORTCODE",
  mpesaConsumerKey: "MPESA_CONSUMER_KEY",
  mpesaConsumerSecret: "MPESA_CONSUMER_SECRET",
  mpesaPasskey: "MPESA_PASSKEY",
  smsUsername: "AT_USERNAME",
  smsApiKey: "AT_API_KEY",
  smsSenderId: "AT_SENDER_ID",
} as const satisfies Record<keyof z.infer<typeof SaveSchema>, TenantServiceSecretName>;

export const saveTenantServiceCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input) => SaveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantAdminId(context.userId);
    const entries: [keyof typeof FIELD_NAMES, string | undefined][] = [
      ["mpesaEnvironment", data.mpesaEnvironment],
      ["mpesaShortcode", data.mpesaShortcode],
      ["mpesaConsumerKey", data.mpesaConsumerKey],
      ["mpesaConsumerSecret", data.mpesaConsumerSecret],
      ["mpesaPasskey", data.mpesaPasskey],
      ["smsUsername", data.smsUsername],
      ["smsApiKey", data.smsApiKey],
      ["smsSenderId", data.smsSenderId],
    ];
    for (const [field, value] of entries) {
      if (!value) continue;
      await saveTenantServiceSecret(tenantId, FIELD_NAMES[field], value, context.userId);
    }
    return getStatus(tenantId);
  });

export const removeTenantServiceCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }) => {
    const tenantId = await tenantAdminId(context.userId);
    await deleteTenantServiceSecrets(tenantId);
    return getStatus(tenantId);
  });
