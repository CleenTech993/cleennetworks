import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { normalizePhone } from "@/lib/mpesa.server";
import { queryDarajaStkPush } from "@/lib/daraja.server";
import { markPaymentFailed, settlePayment } from "@/lib/payment-settle.server";

type DarajaCallback = {
  Body?: {
    stkCallback?: {
      CheckoutRequestID?: string;
      MerchantRequestID?: string;
      ResultCode?: number | string;
      CallbackMetadata?: { Item?: { Name?: string; Value?: string | number }[] };
    };
  };
};

async function handleDarajaCallback(tenantId: string, raw: DarajaCallback): Promise<Response> {
  const rawJson = raw as unknown as Json;
  const callback = raw.Body?.stkCallback;
  const checkoutId = callback?.CheckoutRequestID;
  if (!callback || !checkoutId) return Response.json({ ok: true, note: "No payment reference" });

  const { data: payment } = await supabaseAdmin
    .from("payments")
    .select(
      "id,tenant_id,package_id,customer_id,status,merchant_request_id,checkout_request_id,phone,amount,tv_device_id,expires_at",
    )
    .eq("tenant_id", tenantId)
    .eq("provider", "daraja")
    .eq("checkout_request_id", checkoutId)
    .maybeSingle();
  if (!payment) return Response.json({ ok: true, note: "Unknown payment" });
  if (payment.status === "success" || payment.status === "processing") {
    return Response.json({ ok: true, note: "Already processed" });
  }
  if (
    callback.MerchantRequestID &&
    payment.merchant_request_id &&
    callback.MerchantRequestID !== payment.merchant_request_id
  ) {
    return Response.json({ ok: true, note: "Request mismatch" });
  }

  if (String(callback.ResultCode) !== "0") {
    // A forged callback could cancel a legitimate pending payment. Confirm the
    // cancellation with Daraja itself before marking anything failed.
    try {
      const verification = await queryDarajaStkPush(tenantId, checkoutId);
      if (verification.resultCode !== null && verification.resultCode !== "0") {
        await markPaymentFailed(payment.id, rawJson);
      }
    } catch (error) {
      console.error("Daraja callback verification failed", error);
      return Response.json({ ok: false, error: "Verification failed" }, { status: 502 });
    }
    return Response.json({ ok: true, note: "Payment was not completed" });
  }

  const metadata = callback.CallbackMetadata?.Item ?? [];
  const value = (name: string) => metadata.find((item) => item.Name === name)?.Value;
  const amount = Number(value("Amount"));
  const receipt = value("MpesaReceiptNumber");
  const phone = value("PhoneNumber");
  if (
    !Number.isFinite(amount) ||
    amount !== Math.ceil(Number(payment.amount)) ||
    typeof receipt !== "string" ||
    !receipt ||
    (phone !== undefined && normalizePhone(String(phone)) !== payment.phone)
  ) {
    console.error(`Daraja callback data did not match payment ${payment.id}`);
    return Response.json({ ok: true, note: "Payment details did not match" });
  }

  let verification: Awaited<ReturnType<typeof queryDarajaStkPush>>;
  try {
    verification = await queryDarajaStkPush(tenantId, checkoutId);
  } catch (error) {
    console.error("Daraja callback verification failed", error);
    return Response.json({ ok: false, error: "Verification failed" }, { status: 502 });
  }
  if (verification.resultCode !== "0") {
    return Response.json({ ok: true, note: "Payment verification is still pending" });
  }

  try {
    const outcome = await settlePayment({
      payment: {
        id: payment.id,
        tenant_id: tenantId,
        package_id: payment.package_id,
        phone: payment.phone,
        tv_device_id: payment.tv_device_id,
        expires_at: payment.expires_at,
      },
      receipt,
      raw: rawJson,
    });
    if (outcome === "already") return Response.json({ ok: true, note: "Already processing" });
  } catch (error) {
    console.error("Daraja callback processing failed", error);
    return Response.json({ ok: false, error: "Processing failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
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
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        if (!("Body" in body)) return Response.json({ ok: true, note: "Unknown callback" });
        return handleDarajaCallback(tenantId, body as DarajaCallback);
      },
    },
  },
});
