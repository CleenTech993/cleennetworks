import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { randomVoucher } from "@/lib/mpesa.server";

interface CallbackItem {
  Name: string;
  Value?: string | number;
}

export const Route = createFileRoute("/api/public/mpesa/callback/$tenantId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const tenantId = params.tenantId;
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ ResultCode: 1, ResultDesc: "Invalid JSON" }, { status: 400 });
        }
        const rawJson = body as unknown as never;

        const stk = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
        if (!stk) {
          // Acknowledge so Safaricom doesn't retry forever
          return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
        }

        const checkoutRequestId = stk.CheckoutRequestID as string | undefined;
        const resultCode = stk.ResultCode as number | undefined;
        const meta = (stk.CallbackMetadata as { Item?: CallbackItem[] } | undefined)?.Item ?? [];
        const get = (n: string) => meta.find((i) => i.Name === n)?.Value;

        if (!checkoutRequestId) {
          return Response.json({ ResultCode: 0, ResultDesc: "No checkout id" });
        }

        const { data: payment } = await supabaseAdmin
          .from("payments")
          .select("id,tenant_id,package_id,customer_id,status")
          .eq("tenant_id", tenantId)
          .eq("checkout_request_id", checkoutRequestId)
          .maybeSingle();

        if (!payment) {
          return Response.json({ ResultCode: 0, ResultDesc: "Unknown payment" });
        }

        if (resultCode !== 0) {
          await supabaseAdmin
            .from("payments")
            .update({ status: "failed", raw_callback: rawJson })
            .eq("id", payment.id);
          return Response.json({ ResultCode: 0, ResultDesc: "Recorded failure" });
        }

        const receipt = String(get("MpesaReceiptNumber") ?? "");
        const phone = String(get("PhoneNumber") ?? "");
        const amount = Number(get("Amount") ?? 0);

        // Mint a voucher for hotspot packages
        let voucherCode: string | null = null;
        if (payment.package_id) {
          const { data: pkg } = await supabaseAdmin
            .from("packages")
            .select("kind,duration_value,duration_unit")
            .eq("id", payment.package_id)
            .maybeSingle();
          if (pkg?.kind === "hotspot" || pkg?.kind === "voucher") {
            voucherCode = randomVoucher();
            const expiresAt = pkg.duration_value && pkg.duration_unit
              ? expiryFrom(pkg.duration_value, pkg.duration_unit)
              : null;
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
          })
          .eq("id", payment.id);

        return Response.json({ ResultCode: 0, ResultDesc: "OK" });
      },
    },
  },
});

function expiryFrom(value: number, unit: string): string {
  const ms =
    unit === "minute" ? value * 60_000 :
    unit === "hour"   ? value * 3_600_000 :
    unit === "day"    ? value * 86_400_000 :
    unit === "week"   ? value * 7 * 86_400_000 :
    unit === "month"  ? value * 30 * 86_400_000 :
    value * 86_400_000;
  return new Date(Date.now() + ms).toISOString();
}
