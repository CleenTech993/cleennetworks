import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadPlatformServiceSecrets } from "@/lib/platform-service-secrets.server";

export const getPlatformInvoicePaymentDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .handler(async ({ context }) => {
    const { data: role, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("tenant_id")
      .eq("user_id", context.userId)
      .in("role", ["tenant_admin", "billing_agent"])
      .not("tenant_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (roleError) throw roleError;
    if (!role?.tenant_id) throw new Error("Tenant billing access is required.");

    const [{ data, error }, secrets] = await Promise.all([
      supabaseAdmin.from("platform_mpesa_config").select("shortcode").eq("id", 1).maybeSingle(),
      loadPlatformServiceSecrets(),
    ]);
    if (error) throw error;
    return {
      shortcode: data?.shortcode ?? null,
      merchantType: secrets.PLATFORM_MPESA_MERCHANT_TYPE === "buygoods" ? "buygoods" : "paybill",
      stkAvailable: Boolean(
        (secrets.PLATFORM_MPESA_ENV === "sandbox" || secrets.PLATFORM_MPESA_ENV === "production") &&
        secrets.PLATFORM_MPESA_CONSUMER_KEY &&
        secrets.PLATFORM_MPESA_CONSUMER_SECRET &&
        secrets.PLATFORM_MPESA_BUSINESS_SHORTCODE &&
        secrets.PLATFORM_MPESA_PASSKEY,
      ),
    };
  });
