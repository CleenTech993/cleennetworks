import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { randomVoucher, expiryFrom, payheroTransactionStatus } from "@/lib/mpesa.server";

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
          .select("id,tenant_id,package_id,customer_id,status,merchant_request_id")
          .eq("tenant_id", tenantId);
        q = /^[0-9a-f-]{36}$/i.test(externalRef) ? q.eq("id", externalRef) : q.eq("checkout_request_id", checkoutId);
        const { data: payment } = await q.maybeSingle();

        if (!payment) return Response.json({ ok: true, note: "Unknown payment" });
        if (payment.status === "success") return Response.json({ ok: true, note: "Already processed" });

        // Verify with PayHero directly
        let verified = { status: "", receipt: null as string | null };
        try {
          if (payment.merchant_request_id) verified = await payheroTransactionStatus(payment.merchant_request_id);
        } catch (e) {
          console.error(e);
          return Response.json({ ok: false, error: "Verification failed" }, { status: 502 });
        }

        if (verified.status === "FAILED") {
          await supabaseAdmin.from("payments").update({ status: "failed", raw_callback: rawJson }).eq("id", payment.id);
          return Response.json({ ok: true, note: "Recorded failure" });
        }
        if (verified.status !== "SUCCESS") return Response.json({ ok: true, note: "Pending" });

        const receipt = String(verified.receipt ?? r.MpesaReceiptNumber ?? "");
        const phone = String(r.Phone ?? "").replace(/\D/g, "");
        const amount = Number(r.Amount ?? 0);

        let voucherCode: string | null = null;
        let expiresAt: string | null = null;
        if (payment.package_id) {
          const { data: pkg } = await supabaseAdmin
            .from("packages")
            .select("kind,duration_value,duration_unit")
            .eq("id", payment.package_id)
            .maybeSingle();
          if (pkg?.duration_value && pkg?.duration_unit) {
            expiresAt = expiryFrom(pkg.duration_value, pkg.duration_unit);
          }
          if (pkg?.kind === "hotspot" || pkg?.kind === "voucher") {
            voucherCode = randomVoucher();
            await supabaseAdmin.from("vouchers").insert({
              tenant_id: tenantId,
              package_id: payment.package_id,
              code: voucherCode,
              payment_id: payment.id,
              expires_at: expiresAt,
            });
          }
        }

        await supabaseAdmin
          .from("payments")
          .update({
            status: "success",
            mpesa_receipt: receipt,
            phone: phone || undefined,
            amount: amount || undefined,
            raw_callback: rawJson,
            voucher_code: voucherCode,
            expires_at: expiresAt,
          })
          .eq("id", payment.id);

        return Response.json({ ResultCode: 0, ResultDesc: "OK" });
      },
    },
  },
});
