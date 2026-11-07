import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { registerPlatformDarajaC2bUrl } from "@/lib/daraja.server";
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
  if (!data) throw new Error("Only platform admins can confirm invoice payments.");
}

export const getPlatformC2bStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("platform_mpesa_config")
      .select("shortcode,confirmation_url,validation_url,c2b_registered_at")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    return {
      shortcode: data?.shortcode ?? null,
      confirmationUrl: data?.confirmation_url ?? null,
      validationUrl: data?.validation_url ?? null,
      registeredAt: data?.c2b_registered_at ?? null,
      credentialsConfigured: Boolean(
        (process.env["PLATFORM_MPESA_ENV"] === "sandbox" ||
          process.env["PLATFORM_MPESA_ENV"] === "production") &&
        process.env["PLATFORM_MPESA_CONSUMER_KEY"] &&
        process.env["PLATFORM_MPESA_CONSUMER_SECRET"] &&
        process.env["APP_BASE_URL"],
      ),
    };
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

    const configuredAppUrl = process.env["APP_BASE_URL"]?.trim();
    if (!configuredAppUrl) throw new Error("Set APP_BASE_URL to the public HTTPS application URL.");
    let baseUrl: string;
    try {
      const parsed = new URL(configuredAppUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        throw new Error("APP_BASE_URL must be a public HTTPS URL.");
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
