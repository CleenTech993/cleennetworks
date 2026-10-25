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
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import {
  CHECKOUT_LIMITS,
  isValidKenyanMobile,
  throttleMessage,
  throttleVerdict,
} from "@/lib/checkout-throttle";

const Schema = z.object({
  packageId: z.string().uuid(),
  phone: z.string().min(7).max(20),
});

export const Route = createFileRoute("/api/public/portal/$slug/checkout")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        // Cheap per-IP gate first (per-instance; the per-phone limit below is the durable one).
        if (!rateLimit(`checkout:${params.slug}:${clientIp(request)}`, CHECKOUT_LIMITS.ipMax, CHECKOUT_LIMITS.ipWindowMs)) {
          return tooManyRequests();
        }
        let body: unknown;
        try { body = await request.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

        const phone = normalizePhone(parsed.data.phone);
        if (!isValidKenyanMobile(phone)) {
          return Response.json({ error: "Enter a valid M-Pesa number, e.g. 0712345678." }, { status: 400 });
        }

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
              phone,
              amount: pkg.price,
              status: "pending",
            })
            .select("id,created_at,status,package_id")
            .single();
          if (payErr || !pay) return Response.json({ error: "Could not start the payment." }, { status: 500 });

          // Per-phone limit, shared across server instances because it counts payment rows. The
          // row is inserted first and then ranked against earlier ones, so parallel requests
          // cannot all pass. A refused attempt is deleted so it does not count against the phone.
          const { data: others, error: othersErr } = await supabaseAdmin
            .from("payments")
            .select("id,created_at,status,package_id")
            .eq("tenant_id", tenant.id)
            .eq("phone", phone)
            .neq("id", pay.id)
            .gte("created_at", new Date(Date.now() - CHECKOUT_LIMITS.phoneWindowMs).toISOString());
          if (othersErr) {
            await supabaseAdmin.from("payments").delete().eq("id", pay.id);
            return Response.json({ error: "Please try again in a moment." }, { status: 503 });
          }
          const verdict = throttleVerdict(pay, others ?? []);
          if (!verdict.ok) {
            await supabaseAdmin.from("payments").delete().eq("id", pay.id);
            return Response.json(
              { error: throttleMessage(verdict) },
              { status: 429, headers: { "retry-after": String(verdict.retryAfterSec) } },
            );
          }

          const host = getRequestHost();
          const callbackBase = cfg.callback_base_url?.replace(/\/$/, "") ?? `https://${host}`;
          const result = await stkPush({
            cfg,
            amount: Number(pkg.price),
            phone,
            reference: pay.id,
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
