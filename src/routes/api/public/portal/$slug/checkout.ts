import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRequestHost } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadTenantBySlugAdmin, normalizePhone } from "@/lib/mpesa.server";
import {
  tenantServiceRestriction,
  tenantServiceRestrictionMessage,
} from "@/lib/platform-billing.server";
import { startDarajaStkPush } from "@/lib/daraja.server";
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
        if (
          !rateLimit(
            `checkout:${params.slug}:${clientIp(request)}`,
            CHECKOUT_LIMITS.ipMax,
            CHECKOUT_LIMITS.ipWindowMs,
          )
        ) {
          return tooManyRequests();
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Bad JSON" }, { status: 400 });
        }
        const parsed = Schema.safeParse(body);
        if (!parsed.success)
          return Response.json({ error: "Please fill in all fields." }, { status: 400 });

        const phone = normalizePhone(parsed.data.phone);
        if (!isValidKenyanMobile(phone)) {
          return Response.json(
            { error: "Enter a valid M-Pesa number, e.g. 0712345678." },
            { status: 400 },
          );
        }

        try {
          const tenant = await loadTenantBySlugAdmin(params.slug).catch(() => null);
          if (!tenant) return Response.json({ error: "Portal not found" }, { status: 404 });
          const restriction = await tenantServiceRestriction(tenant.id);
          if (restriction) {
            return Response.json(
              { error: tenantServiceRestrictionMessage(restriction) },
              { status: 423 },
            );
          }

          const { data: pkg } = await supabaseAdmin
            .from("packages")
            .select("id,name,price,kind,tenant_id,active")
            .eq("id", parsed.data.packageId)
            .single();
          if (!pkg || pkg.tenant_id !== tenant.id || !pkg.active) {
            return Response.json({ error: "Invalid package" }, { status: 400 });
          }
          const amount = Math.ceil(Number(pkg.price));
          if (!Number.isFinite(amount) || amount < 1) {
            return Response.json(
              { error: "This package cannot be paid for online." },
              { status: 400 },
            );
          }

          const { data: pay, error: payErr } = await supabaseAdmin
            .from("payments")
            .insert({
              tenant_id: tenant.id,
              package_id: pkg.id,
              phone,
              amount,
              status: "pending",
              provider: "daraja",
            })
            .select("id,created_at,status,package_id")
            .single();
          if (payErr || !pay)
            return Response.json({ error: "Could not start the payment." }, { status: 500 });

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

          let started;
          try {
            started = await startDarajaStkPush({
              tenantId: tenant.id,
              amount,
              phone,
              paymentId: pay.id,
              description: pkg.kind ?? "Internet",
              callbackUrl: `https://${getRequestHost()}/api/public/mpesa/callback/${tenant.id}`,
            });
          } catch (e) {
            // Gateway text can contain internals (URLs, account ids): log it and show a generic message.
            console.error("checkout: STK push failed", e);
            // Close the attempt so it is not left "pending" for ever. It stays on record: the checkout
            // limiter counts every attempt, which stops failed prompts being used to spam a phone.
            await supabaseAdmin.from("payments").update({ status: "failed" }).eq("id", pay.id);
            return Response.json(
              {
                error: "We couldn't send the M-Pesa prompt. Please check the number and try again.",
              },
              { status: 502 },
            );
          }

          await supabaseAdmin
            .from("payments")
            .update({
              checkout_request_id: started.checkoutRequestId,
              merchant_request_id: started.merchantRequestId,
            })
            .eq("id", pay.id);

          return Response.json({
            paymentId: pay.id,
            checkoutRequestId: started.checkoutRequestId,
            message: "Check your phone for the M-Pesa prompt",
          });
        } catch (e) {
          console.error("checkout failed", e);
          return Response.json(
            { error: "Something went wrong. Please try again." },
            { status: 500 },
          );
        }
      },
    },
  },
});
