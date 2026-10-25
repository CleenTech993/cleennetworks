import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestHost } from "@tanstack/react-start/server";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { loadPlatformMpesaConfig, stkPush, normalizePhone } from "./mpesa.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const StkSchema = z.object({
  packageId: z.string().uuid(),
  phone: z.string().min(7).max(20),
  customerId: z.string().uuid().optional(),
});

export const initiateStkPushTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input) => StkSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Resolve tenant of the current user
    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("tenant_id")
      .single();
    if (pErr || !profile?.tenant_id) throw new Error("No tenant context");
    const tenantId = profile.tenant_id as string;

    const { data: pkg, error: kErr } = await supabase
      .from("packages")
      .select("id,name,price,tenant_id,kind")
      .eq("id", data.packageId)
      .single();
    if (kErr || !pkg || pkg.tenant_id !== tenantId) throw new Error("Package not found");

    const cfg = await loadPlatformMpesaConfig();

    const host = getRequestHost();
    const callbackBase = cfg.callback_base_url?.replace(/\/$/, "") ?? `https://${host}`;
    const callbackUrl = `${callbackBase}/api/public/mpesa/callback/${tenantId}`;

    // Insert pending payment first so the callback can find it
    const { data: pay, error: payErr } = await supabaseAdmin
      .from("payments")
      .insert({
        tenant_id: tenantId,
        customer_id: data.customerId ?? null,
        package_id: pkg.id,
        phone: normalizePhone(data.phone),
        amount: pkg.price,
        status: "pending",
      })
      .select("id")
      .single();
    if (payErr || !pay) throw new Error(payErr?.message ?? "Could not create payment");

    const result = await stkPush({
      cfg,
      amount: Number(pkg.price),
      phone: data.phone,
      reference: pay.id,
      description: pkg.kind ?? "Internet",
      callbackUrl,
    });

    await supabaseAdmin
      .from("payments")
      .update({
        checkout_request_id: result.CheckoutRequestID,
        merchant_request_id: result.MerchantRequestID,
      })
      .eq("id", pay.id);

    return {
      paymentId: pay.id,
      checkoutRequestId: result.CheckoutRequestID,
      message: result.CustomerMessage,
    };
  });
