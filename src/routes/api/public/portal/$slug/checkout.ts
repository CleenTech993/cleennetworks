import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRequestHost } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  loadTenantBySlugAdmin,
  loadPlatformMpesaConfig,
  stkPush,
  normalizePhone,
  isKenyanMobile,
} from "@/lib/mpesa.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { PHONE_WINDOW_MS, evaluatePhoneAttempts } from "@/lib/checkout-guard";

const Schema = z.object({
  packageId: z.string().uuid(),
  phone: z.string().min(7).max(20),
});

const GENERIC_FAILURE = "Could not send the M-Pesa prompt. Please check the number and try again.";

export const Route = createFileRoute("/api/public/portal/$slug/checkout")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        // Best-effort, per instance: stops casual hammering before we touch the database.
        const ip = clientIp(request);
        if (!rateLimit(`checkout:${params.slug}:${ip}`, 6, 60_000)) return tooManyRequests();
        if (!rateLimit(`checkout-ip:${ip}`, 12, 60_000)) return tooManyRequests();

        let body: unknown;
        try { body = await request.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

        const phone = normalizePhone(parsed.data.phone);
        if (!isKenyanMobile(phone)) {
          return Response.json({ error: "Enter a valid Safaricom number, e.g. 0712 345 678." }, { status: 400 });
        }

        let tenant;
        try {
          tenant = await loadTenantBySlugAdmin(params.slug);
        } catch {
          return Response.json({ error: "Portal not found" }, { status: 404 });
        }

        const { data: pkg } = await supabaseAdmin
          .from("packages")
          .select("id,name,price,kind,tenant_id,active")
          .eq("id", parsed.data.packageId)
          .maybeSingle();
        if (!pkg || pkg.tenant_id !== tenant.id || !pkg.active) {
          return Response.json({ error: "Invalid package" }, { status: 400 });
        }

        // Record the attempt FIRST, then count: concurrent requests all see the same ordered list,
        // so only the earliest few survive (see checkout-guard.ts).
        const { data: pay, error: payErr } = await supabaseAdmin
          .from("payments")
          .insert({ tenant_id: tenant.id, package_id: pkg.id, phone, amount: pkg.price, status: "pending" })
          .select("id")
          .single();
        if (payErr || !pay) {
          console.error("checkout: could not record payment", payErr);
          return Response.json({ error: GENERIC_FAILURE }, { status: 500 });
        }

        const since = new Date(Date.now() - PHONE_WINDOW_MS).toISOString();
        const { data: attempts, error: attErr } = await supabaseAdmin
          .from("payments")
          .select("id,created_at")
          .eq("phone", phone)
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(50);
        const verdict = attErr
          ? ({ ok: false, reason: "limit", retryAfterSec: 60, message: GENERIC_FAILURE } as const) // fail closed
          : evaluatePhoneAttempts(attempts ?? [], pay.id);
        if (!verdict.ok) {
          // Nothing was sent to the phone, so drop the row instead of leaving junk behind.
          await supabaseAdmin.from("payments").delete().eq("id", pay.id).eq("status", "pending");
          return Response.json(
            { error: verdict.message },
            { status: 429, headers: { "retry-after": String(verdict.retryAfterSec) } },
          );
        }

        try {
          const cfg = await loadPlatformMpesaConfig();
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
          // Log the real reason server-side; never hand gateway internals to an anonymous caller.
          console.error("checkout: STK push failed", e);
          await supabaseAdmin.from("payments").update({ status: "failed" }).eq("id", pay.id).eq("status", "pending");
          return Response.json({ error: GENERIC_FAILURE }, { status: 502 });
        }
      },
    },
  },
});
