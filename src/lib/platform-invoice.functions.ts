import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { registerPlatformDarajaC2bUrl } from "@/lib/daraja.server";
import {
  loadPlatformServiceSecrets,
  savePlatformServiceSecret,
  type PlatformServiceSecretName,
} from "@/lib/platform-service-secrets.server";
import { requireSupabaseAal2 } from "@/lib/require-aal2";

const ReceiptSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,40}$/, "Enter a valid M-Pesa transaction code (6–40 letters or numbers).");

const InvoiceReceiptSchema = z.object({
  invoiceId: z.string().uuid(),
  receipt: ReceiptSchema,
});

async function tenantBillingId(userId: string): Promise<string> {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .single();
  if (profileError) throw profileError;
  if (!profile.tenant_id) throw new Error("Tenant billing access is required.");

  const { data: role, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("tenant_id", profile.tenant_id)
    .in("role", ["tenant_admin", "billing_agent"])
    .limit(1)
    .maybeSingle();
  if (roleError) throw roleError;
  if (!role) throw new Error("Tenant billing access is required.");
  return profile.tenant_id;
}

async function requireSuperAdmin(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Only platform admins can manage platform billing.");
}

async function platformC2bStatus() {
  const [secrets, configResult] = await Promise.all([
    loadPlatformServiceSecrets(),
    supabaseAdmin
      .from("platform_mpesa_config")
      .select("shortcode,confirmation_url,validation_url,c2b_registered_at")
      .eq("id", 1)
      .maybeSingle(),
  ]);
  if (configResult.error) throw configResult.error;
  return {
    shortcode: configResult.data?.shortcode ?? null,
    confirmationUrl: configResult.data?.confirmation_url ?? null,
    validationUrl: configResult.data?.validation_url ?? null,
    registeredAt: configResult.data?.c2b_registered_at ?? null,
    appBaseUrl: secrets.APP_BASE_URL ?? null,
    environment:
      secrets.PLATFORM_MPESA_ENV === "sandbox" || secrets.PLATFORM_MPESA_ENV === "production"
        ? secrets.PLATFORM_MPESA_ENV
        : null,
    consumerKeyLast4: secrets.PLATFORM_MPESA_CONSUMER_KEY?.slice(-4) ?? null,
    consumerSecretLast4: secrets.PLATFORM_MPESA_CONSUMER_SECRET?.slice(-4) ?? null,
    credentialsConfigured: Boolean(
      secrets.APP_BASE_URL &&
      (secrets.PLATFORM_MPESA_ENV === "sandbox" || secrets.PLATFORM_MPESA_ENV === "production") &&
      secrets.PLATFORM_MPESA_CONSUMER_KEY &&
      secrets.PLATFORM_MPESA_CONSUMER_SECRET,
    ),
  };
}

export const getPlatformC2bStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.userId);
    return platformC2bStatus();
  });

const SavePlatformC2bSettingsSchema = z
  .object({
    appBaseUrl: z.string().trim().max(500).optional(),
    environment: z.enum(["sandbox", "production"]).optional(),
    consumerKey: z.string().trim().max(500).optional(),
    consumerSecret: z.string().trim().max(500).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => Boolean(entry)), {
    message: "Enter at least one setting to save.",
  });

export const savePlatformC2bSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof SavePlatformC2bSettingsSchema>) =>
    SavePlatformC2bSettingsSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);

    let appBaseUrl = data.appBaseUrl;
    if (appBaseUrl) {
      let parsed: URL;
      try {
        parsed = new URL(appBaseUrl);
      } catch {
        throw new Error("Enter a valid public HTTPS application URL.");
      }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        throw new Error("The application URL must use HTTPS and cannot include credentials.");
      }
      appBaseUrl = parsed.origin;
    }

    const entries: [PlatformServiceSecretName, string | undefined][] = [
      ["APP_BASE_URL", appBaseUrl],
      ["PLATFORM_MPESA_ENV", data.environment],
      ["PLATFORM_MPESA_CONSUMER_KEY", data.consumerKey],
      ["PLATFORM_MPESA_CONSUMER_SECRET", data.consumerSecret],
    ];
    for (const [name, value] of entries) {
      if (value) await savePlatformServiceSecret(name, value, context.userId);
    }

    const { error } = await supabaseAdmin
      .from("platform_mpesa_config")
      .update({
        c2b_registered_at: null,
        callback_base_url: null,
        confirmation_url: null,
        validation_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw error;

    return platformC2bStatus();
  });

export const registerPlatformC2bCallbacks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.userId);
    const { data: config, error } = await supabaseAdmin
      .from("platform_mpesa_config")
      .select("shortcode,c2b_callback_token")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    const shortcode = config?.shortcode?.trim();
    if (!shortcode || !/^\d{5,20}$/.test(shortcode)) {
      throw new Error("Save a valid platform PayBill shortcode before registering callbacks.");
    }

    const secrets = await loadPlatformServiceSecrets();
    const configuredAppUrl = secrets.APP_BASE_URL?.trim();
    if (!configuredAppUrl)
      throw new Error("Set the public HTTPS application URL in platform settings.");
    let baseUrl: string;
    try {
      const parsed = new URL(configuredAppUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        throw new Error("The saved application URL must use HTTPS and cannot include credentials.");
      }
      baseUrl = parsed.origin;
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : "The public application URL is invalid.",
      );
    }
    const token = config.c2b_callback_token || randomBytes(32).toString("hex");
    const validationUrl = `${baseUrl}/api/public/mpesa/platform-c2b-validation/${token}`;
    const confirmationUrl = `${baseUrl}/api/public/mpesa/platform-c2b/${token}`;

    if (!config.c2b_callback_token) {
      const { error: saveTokenError } = await supabaseAdmin
        .from("platform_mpesa_config")
        .update({ c2b_callback_token: token })
        .eq("id", 1);
      if (saveTokenError) throw saveTokenError;
    }

    await registerPlatformDarajaC2bUrl({ shortcode, validationUrl, confirmationUrl });

    const registeredAt = new Date().toISOString();
    const { error: saveUrlsError } = await supabaseAdmin
      .from("platform_mpesa_config")
      .update({
        callback_base_url: baseUrl,
        validation_url: validationUrl,
        confirmation_url: confirmationUrl,
        c2b_registered_at: registeredAt,
        updated_at: registeredAt,
      })
      .eq("id", 1);
    if (saveUrlsError) throw saveUrlsError;

    return { shortcode, validationUrl, confirmationUrl, registeredAt };
  });

export const submitPlatformInvoiceReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof InvoiceReceiptSchema>) => InvoiceReceiptSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantBillingId(context.userId);
    const { error, data: updated } = await supabaseAdmin
      .from("platform_commissions")
      .update({ tenant_mpesa_receipt: data.receipt })
      .eq("id", data.invoiceId)
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error?.code === "23505") {
      throw new Error("That transaction code has already been submitted for another invoice.");
    }
    if (error) throw error;
    if (!updated) throw new Error("This invoice is no longer awaiting payment.");
    return { submitted: true };
  });

export const confirmPlatformInvoiceReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof InvoiceReceiptSchema>) => InvoiceReceiptSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("platform_commissions")
      .select("tenant_mpesa_receipt")
      .eq("id", data.invoiceId)
      .eq("status", "pending")
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) throw new Error("This invoice is no longer awaiting payment.");
    if (!invoice.tenant_mpesa_receipt) {
      throw new Error("The tenant has not submitted a transaction code yet.");
    }
    if (invoice.tenant_mpesa_receipt !== data.receipt) {
      throw new Error("The code does not match the tenant-submitted transaction code.");
    }

    const { data: updated, error } = await supabaseAdmin
      .from("platform_commissions")
      .update({
        status: "collected",
        mpesa_receipt: data.receipt,
        collected_at: new Date().toISOString(),
      })
      .eq("id", data.invoiceId)
      .eq("status", "pending")
      .eq("tenant_mpesa_receipt", data.receipt)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error("The submitted code changed; reload the invoice and try again.");
    return { confirmed: true };
  });
