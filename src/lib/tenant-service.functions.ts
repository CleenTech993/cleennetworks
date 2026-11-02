import { createServerFn } from "@tanstack/react-start";
import { getRequestHost } from "@tanstack/react-start/server";
import { z } from "zod";
import { renewedExpiry } from "@/lib/pppoe";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { registerDarajaC2bUrl } from "@/lib/daraja.server";
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
    mpesaEnvironment: (secrets.MPESA_ENV === "production" ? "production" : "sandbox") as
      "sandbox" | "production",
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
  .inputValidator((input: z.input<typeof SaveSchema>) => SaveSchema.parse(input))
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

export const registerTenantC2bCallbacks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }) => {
    const tenantId = await tenantAdminId(context.userId);
    const { data: tenant, error } = await supabaseAdmin
      .from("tenants")
      .select("mpesa_paybill,mpesa_till")
      .eq("id", tenantId)
      .single();
    if (error || !tenant) throw new Error("Tenant receiving details could not be loaded.");

    const secrets = await loadTenantServiceSecrets(tenantId);
    const shortcodes = [tenant.mpesa_paybill, tenant.mpesa_till, secrets.MPESA_SHORTCODE].filter(
      (value): value is string => Boolean(value?.trim()),
    );
    const uniqueShortcodes = [...new Set(shortcodes.map((value) => value.trim()))];
    if (!uniqueShortcodes.length) {
      throw new Error("Enter a PayBill or Till shortcode in Receiving details first.");
    }

    const host = getRequestHost();
    if (!host) throw new Error("The public application host could not be determined.");
    const results: { shortcode: string; registered: boolean }[] = [];
    for (const shortcode of uniqueShortcodes) {
      if (!/^\d{5,20}$/.test(shortcode)) {
        results.push({ shortcode, registered: false });
        continue;
      }
      const callbackRoot = `https://${host}/api/public/mpesa`;
      try {
        await registerDarajaC2bUrl({
          tenantId,
          shortcode,
          validationUrl: `${callbackRoot}/c2b-validation/${tenantId}/${shortcode}`,
          confirmationUrl: `${callbackRoot}/c2b/${tenantId}/${shortcode}`,
        });
        results.push({ shortcode, registered: true });
      } catch (error) {
        console.error(`C2B callback registration failed for tenant ${tenantId}`, error);
        results.push({ shortcode, registered: false });
      }
    }
    return { results };
  });

const ReviewDirectPaymentSchema = z.discriminatedUnion("action", [
  z.object({
    transactionId: z.string().uuid(),
    action: z.literal("reject"),
  }),
  z.object({
    transactionId: z.string().uuid(),
    action: z.literal("approve"),
    customerId: z.string().uuid(),
    packageId: z.string().uuid(),
  }),
]);

export const reviewDirectMpesaTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input: z.input<typeof ReviewDirectPaymentSchema>) =>
    ReviewDirectPaymentSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenantAdminId(context.userId);
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("direct_mpesa_transactions")
      .select("id,tenant_id,amount,status")
      .eq("id", data.transactionId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (transactionError || !transaction || transaction.status !== "received") {
      throw new Error("This transaction is no longer awaiting review.");
    }

    if (data.action === "reject") {
      const { data: rejected, error } = await supabaseAdmin
        .from("direct_mpesa_transactions")
        .update({
          status: "rejected",
          reviewed_by: context.userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", data.transactionId)
        .eq("tenant_id", tenantId)
        .eq("status", "received")
        .select("id")
        .maybeSingle();
      if (error || !rejected) throw new Error("Could not reject this transaction.");
      return;
    }

    const { data: customer, error: customerError } = await supabaseAdmin
      .from("customers")
      .select("id,customer_type,package_id,expires_at")
      .eq("id", data.customerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (customerError || !customer || customer.customer_type !== "pppoe") {
      throw new Error("Select a PPPoE customer belonging to this tenant.");
    }

    const { data: pkg, error: packageError } = await supabaseAdmin
      .from("packages")
      .select("id,kind,active,price,duration_value,duration_unit,tenant_id")
      .eq("id", data.packageId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (
      packageError ||
      !pkg ||
      pkg.kind !== "pppoe" ||
      !pkg.active ||
      !pkg.duration_value ||
      !pkg.duration_unit
    ) {
      throw new Error("Choose an active PPPoE package with a valid duration.");
    }
    if (Number(transaction.amount) !== Math.ceil(Number(pkg.price))) {
      throw new Error("The selected package price does not match the M-Pesa amount.");
    }

    const expiresAt = renewedExpiry(customer.expires_at, pkg.duration_value, pkg.duration_unit);
    const { error: approveError } = await supabaseAdmin.rpc("approve_direct_mpesa_transaction", {
      p_transaction_id: transaction.id,
      p_tenant_id: tenantId,
      p_customer_id: customer.id,
      p_package_id: pkg.id,
      p_expires_at: expiresAt,
      p_reviewed_by: context.userId,
    });
    if (approveError) {
      console.error("Could not approve direct M-Pesa transaction", approveError);
      throw new Error("Could not approve this payment. Verify it and try again.");
    }
  });
