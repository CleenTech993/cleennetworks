import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { payheroTransactionStatus } from "@/lib/mpesa.server";
import { markPaymentFailed, settlePayment } from "@/lib/payment-settle.server";

// PayHero payment callback. The callback body is NOT trusted: we look up the
// payment by its external_reference and re-verify the status with PayHero.
export const Route = createFileRoute("/api/public/mpesa/callback/$tenantId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const tenantId = params.tenantId;
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const rawJson = body as unknown as never;
        const r = (body.response ?? {}) as Record<string, unknown>;
        const externalRef = String(r.ExternalReference ?? "");
        const checkoutId = String(r.CheckoutRequestID ?? "");
        if (!externalRef && !checkoutId) return Response.json({ ok: true });

        let q = supabaseAdmin
          .from("payments")
          .select("id,tenant_id,package_id,customer_id,status,merchant_request_id,phone,tv_device_id,expires_at")
          .eq("tenant_id", tenantId);
        q = /^[0-9a-f-]{36}$/i.test(externalRef) ? q.eq("id", externalRef) : q.eq("checkout_request_id", checkoutId);
        const { data: payment } = await q.maybeSingle();

        if (!payment) return Response.json({ ok: true, note: "Unknown payment" });
        if (payment.status === "success" || payment.status === "processing") {
          return Response.json({ ok: true, note: "Already processed" });
        }

        // Verify with PayHero directly
        let verified = { status: "", receipt: null as string | null };
        try {
          if (payment.merchant_request_id) verified = await payheroTransactionStatus(payment.merchant_request_id);
        } catch (e) {
          console.error(e);
          return Response.json({ ok: false, error: "Verification failed" }, { status: 502 });
        }

        if (verified.status === "FAILED") {
          await markPaymentFailed(payment.id, rawJson);
          return Response.json({ ok: true, note: "Recorded failure" });
        }
        if (verified.status !== "SUCCESS") return Response.json({ ok: true, note: "Pending" });

        const receipt = String(verified.receipt ?? r.MpesaReceiptNumber ?? "");
        // Keep the amount recorded at STK-push time; the callback body is untrusted.
        const phone = payment.phone ?? String(r.Phone ?? "").replace(/\D/g, "");

        try {
          const outcome = await settlePayment({
            payment: {
              id: payment.id,
              tenant_id: tenantId,
              package_id: payment.package_id,
              phone: phone || null,
              tv_device_id: payment.tv_device_id,
              expires_at: payment.expires_at,
            },
            receipt: receipt || null,
            raw: rawJson,
          });
          if (outcome === "already") return Response.json({ ok: true, note: "Already processing" });
        } catch (e) {
          // settlePayment released the claim so PayHero's retry can reprocess.
          console.error("callback processing failed", e);
          return Response.json({ ok: false, error: "Processing failed" }, { status: 500 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
