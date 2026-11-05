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
import { isValidKenyanMobile } from "@/lib/phone";

const Schema = z.object({
  packageId: z.string().uuid(),
  phone: z.string().min(7).max(20),
});
const STK_PENDING_TIMEOUT_MS = 10 * 60_000;

export const Route = createFileRoute("/api/public/portal/$slug/checkout")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
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

          const staleBefore = new Date(Date.now() - STK_PENDING_TIMEOUT_MS).toISOString();
          const { error: expireError } = await supabaseAdmin
            .from("payments")
            .update({ status: "failed" })
            .eq("tenant_id", tenant.id)
            .eq("phone", phone)
            .eq("status", "pending")
            .lt("created_at", staleBefore);
          if (expireError) {
            console.error("Could not expire stale STK payment", expireError);
            return Response.json({ error: "Could not start the payment." }, { status: 500 });
          }

          const { data: activePayment, error: activePaymentError } = await supabaseAdmin
            .from("payments")
            .select("id,package_id")
            .eq("tenant_id", tenant.id)
            .eq("phone", phone)
            .eq("status", "pending")
            .gte("created_at", staleBefore)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (activePaymentError) {
            console.error("Could not check for an active STK payment", activePaymentError);
            return Response.json({ error: "Could not start the payment." }, { status: 500 });
          }
          if (activePayment) {
            if (activePayment.package_id !== pkg.id) {
              return Response.json(
                { error: "A payment prompt is already active for this number. Complete it or wait for it to expire." },
                { status: 409 },
              );
            }
            return Response.json({
              paymentId: activePayment.id,
              message: "A payment prompt is already active for this number.",
            });
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

          let started;
          try {
            started = await startDarajaStkPush({
              tenantId: tenant.id,
              amount,
              phone,
              paymentId: pay.id,
              description: `${tenant.name || "Internet"} - ${pkg.name}`,
              accountReference: pkg.name,
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
                error: `We couldn't start the M-Pesa prompt. Check the phone number and try again. If it still fails, contact ${tenant.name || "the provider"} to verify the PayBill's Daraja setup.`,
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
