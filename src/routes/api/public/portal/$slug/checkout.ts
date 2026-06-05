import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRequestHost } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  loadTenantBySlugAdmin,
  loadPlatformMpesaConfig,
  stkPush,
  normalizePhone,
} from "@/lib/mpesa.server";

const Schema = z.object({
  packageId: z.string().uuid(),
  phone: z.string().min(7).max(20),
});

export const Route = createFileRoute("/api/public/portal/$slug/checkout")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        let body: unknown;
        try { body = await request.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

        try {
          const tenant = await loadTenantBySlugAdmin(params.slug);
          const cfg = await loadPlatformMpesaConfig();

          const { data: pkg } = await supabaseAdmin
            .from("packages")
            .select("id,name,price,kind,tenant_id,active")
            .eq("id", parsed.data.packageId)
            .single();
          if (!pkg || pkg.tenant_id !== tenant.id || !pkg.active) {
            return Response.json({ error: "Invalid package" }, { status: 400 });
          }

          const { data: pay, error: payErr } = await supabaseAdmin
            .from("payments")
            .insert({
              tenant_id: tenant.id,
              package_id: pkg.id,
              phone: normalizePhone(parsed.data.phone),
              amount: pkg.price,
              status: "pending",
            })
            .select("id")
            .single();
          if (payErr || !pay) return Response.json({ error: payErr?.message }, { status: 500 });

          const host = getRequestHost();
          const callbackBase = cfg.callback_base_url?.replace(/\/$/, "") ?? `https://${host}`;
          const result = await stkPush({
            cfg,
            amount: Number(pkg.price),
            phone: parsed.data.phone,
            reference: tenant.slug,
            description: pkg.kind ?? "Internet",
            callbackUrl: `${callbackBase}/api/public/mpesa/callback/${tenant.id}`,
          });

          await supabaseAdmin
            .from("payments")
            .update({
              checkout_request_id: result.CheckoutRequestID,
              merchant_request_id: result.MerchantRequestID,
            })
            .eq("id", pay.id);

          return Response.json({
            paymentId: pay.id,
            checkoutRequestId: result.CheckoutRequestID,
            message: result.CustomerMessage,
          });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
        }
      },
    },
  },
});
