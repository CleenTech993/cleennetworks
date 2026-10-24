import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { randomVoucher, expiryFrom, payheroTransactionStatus } from "@/lib/mpesa.server";
import { renewedExpiry } from "@/lib/pppoe";

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
          await supabaseAdmin.from("payments").update({ status: "failed", raw_callback: rawJson }).eq("id", payment.id);
          return Response.json({ ok: true, note: "Recorded failure" });
        }
        if (verified.status !== "SUCCESS") return Response.json({ ok: true, note: "Pending" });

        // Atomically claim the payment so concurrent/retried callbacks cannot each
        // issue a voucher. Only the request that flips pending|failed -> processing proceeds.
        const { data: claimed } = await supabaseAdmin
          .from("payments")
          .update({ status: "processing" })
          .eq("id", payment.id)
          .in("status", ["pending", "failed"])
          .select("id")
          .maybeSingle();
        if (!claimed) return Response.json({ ok: true, note: "Already processing" });

        const receipt = String(verified.receipt ?? r.MpesaReceiptNumber ?? "");
        // Keep the amount recorded at STK-push time; the callback body is untrusted.
        const phone = payment.phone ?? String(r.Phone ?? "").replace(/\D/g, "");

        try {
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
            if (payment.tv_device_id) {
              // Smart TV: extend the device's access instead of minting a voucher. The new
              // expiry is remembered on the payment first so a retried callback reuses it
              // rather than extending the device a second time.
              if (!pkg?.duration_value || !pkg?.duration_unit) throw new Error("TV package has no duration");
              const { data: dev } = await supabaseAdmin
                .from("tv_devices")
                .select("id,status,expires_at")
                .eq("id", payment.tv_device_id)
                .eq("tenant_id", tenantId)
                .maybeSingle();
              if (!dev) throw new Error("TV device not found");
              expiresAt = payment.expires_at ?? renewedExpiry(dev.expires_at, pkg.duration_value, pkg.duration_unit);
              if (!payment.expires_at) {
                await supabaseAdmin.from("payments").update({ expires_at: expiresAt }).eq("id", payment.id);
              }
              if (dev.status !== "blocked") {
                const { error: dErr } = await supabaseAdmin
                  .from("tv_devices")
                  .update({ status: "active", expires_at: expiresAt, package_id: payment.package_id, updated_at: new Date().toISOString() })
                  .eq("id", dev.id);
                if (dErr) throw dErr;
              }
            } else if (pkg?.kind === "hotspot" || pkg?.kind === "voucher") {
              voucherCode = randomVoucher();
              const { error: vErr } = await supabaseAdmin.from("vouchers").insert({
                tenant_id: tenantId,
                package_id: payment.package_id,
                code: voucherCode,
                payment_id: payment.id,
                expires_at: expiresAt,
              });
              if (vErr) throw vErr;
            }
          }

          const { error: uErr } = await supabaseAdmin
            .from("payments")
            .update({
              status: "success",
              mpesa_receipt: receipt || null,
              phone: phone || undefined,
              raw_callback: rawJson,
              voucher_code: voucherCode,
              expires_at: expiresAt,
            })
            .eq("id", payment.id);
          if (uErr) throw uErr;
        } catch (e) {
          // Release the claim so PayHero's retry can reprocess instead of losing the payment.
          console.error("callback processing failed", e);
          await supabaseAdmin.from("payments").update({ status: "pending" }).eq("id", payment.id);
          return Response.json({ ok: false, error: "Processing failed" }, { status: 500 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
