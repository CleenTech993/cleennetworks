import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { settlePayment, markPaymentFailed } from "@/lib/payment-settle.server";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit.server";

type TransactionStatusCallback = {
  Result?: {
    ResultCode?: string | number;
    ResultDesc?: string;
    TransactionID?: string;
    ResultParameters?: {
      ResultParameter?: { Key?: string; Value?: string | number }[];
    };
  };
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parameter(
  callback: NonNullable<TransactionStatusCallback["Result"]>,
  name: string,
): string | null {
  const entry = callback.ResultParameters?.ResultParameter?.find(
    (item) => item.Key?.toLowerCase() === name.toLowerCase(),
  );
  return entry?.Value == null ? null : String(entry.Value);
}

function amountInCents(value: string | number | null): number | null {
  if (value == null || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export const Route = createFileRoute("/api/public/mpesa/transaction-status/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!/^[a-f0-9]{64}$/i.test(params.token))
          return new Response("Not found", { status: 404 });
        if (!rateLimit(`transaction-status:${params.token}`, 10, 60_000)) return tooManyRequests();

        let body: TransactionStatusCallback;
        try {
          body = (await request.json()) as TransactionStatusCallback;
        } catch {
          return Response.json({ ok: false, error: "Invalid callback body" }, { status: 400 });
        }
        const callback = body.Result;
        if (!callback) {
          return Response.json({ ok: false, error: "Invalid callback body" }, { status: 400 });
        }

        const tokenHash = hashToken(params.token);
        const { data: payment, error: paymentError } = await supabaseAdmin
          .from("payments")
          .select(
            "id,tenant_id,customer_id,package_id,phone,amount,tv_device_id,expires_at,customer_invoice_id,status,mpesa_receipt,manual_mpesa_receipt,manual_verification_status",
          )
          .eq("manual_verification_token_hash", tokenHash)
          .maybeSingle();
        if (paymentError) {
          console.error("Could not load manual M-Pesa verification", paymentError);
          return Response.json({ ok: false, error: "Verification unavailable" }, { status: 503 });
        }
        if (!payment) return new Response("Not found", { status: 404 });
        if (
          payment.manual_verification_status === "verified" ||
          payment.manual_verification_status === "failed"
        ) {
          return Response.json({ ok: true, note: "Already processed" });
        }

        const kind = new URL(request.url).searchParams.get("kind");
        if (kind === "timeout") {
          const { error } = await supabaseAdmin
            .from("payments")
            .update({
              manual_verification_status: "failed",
              manual_verification_error:
                "M-Pesa could not complete receipt verification. Try again.",
            })
            .eq("id", payment.id)
            .eq("manual_verification_token_hash", tokenHash)
            .eq("manual_verification_status", "pending");
          if (error) {
            console.error("Could not save manual M-Pesa timeout", error);
            return Response.json({ ok: false, error: "Verification unavailable" }, { status: 503 });
          }
          return Response.json({ ok: true });
        }
        if (kind !== "result") {
          return Response.json({ ok: false, error: "Unknown callback type" }, { status: 400 });
        }

        const { data: claimed, error: claimError } = await supabaseAdmin
          .from("payments")
          .update({ manual_verification_status: "processing" })
          .eq("id", payment.id)
          .eq("manual_verification_token_hash", tokenHash)
          .eq("manual_verification_status", "pending")
          .select("id")
          .maybeSingle();
        if (claimError) {
          console.error("Could not claim manual M-Pesa result", claimError);
          return Response.json({ ok: false, error: "Verification unavailable" }, { status: 503 });
        }
        if (!claimed) return Response.json({ ok: true, note: "Already processing" });

        const receipt = payment.manual_mpesa_receipt;
        const status = parameter(callback, "TransactionStatus")?.toLowerCase();
        const resultReceipt =
          parameter(callback, "ReceiptNo") ?? callback.TransactionID?.trim() ?? null;
        const resultAmount = amountInCents(
          parameter(callback, "Amount") ?? parameter(callback, "TransactionAmount"),
        );
        const valid =
          String(callback.ResultCode) === "0" &&
          status === "completed" &&
          Boolean(receipt) &&
          resultReceipt?.toUpperCase() === receipt?.toUpperCase() &&
          resultAmount != null &&
          resultAmount === amountInCents(payment.amount);
        if (!valid) {
          const { error } = await supabaseAdmin
            .from("payments")
            .update({
              manual_verification_status: "failed",
              manual_verification_error:
                "M-Pesa did not verify a completed payment for this amount.",
              raw_callback: body as unknown as Json,
            })
            .eq("id", payment.id)
            .eq("manual_verification_token_hash", tokenHash);
          if (error) {
            console.error("Could not save rejected manual M-Pesa result", error);
            return Response.json({ ok: false, error: "Verification unavailable" }, { status: 503 });
          }
          return Response.json({ ok: true, note: "Payment was not verified" });
        }

        try {
          if (payment.status === "success" && payment.mpesa_receipt !== receipt) {
            const { error } = await supabaseAdmin
              .from("payments")
              .update({
                manual_verification_status: "failed",
                manual_verification_error:
                  "This checkout has already been paid. Contact the provider about this extra payment.",
              })
              .eq("id", payment.id)
              .eq("manual_verification_token_hash", tokenHash);
            if (error) {
              console.error("Could not save duplicate manual payment result", error);
              return Response.json(
                { ok: false, error: "Verification unavailable" },
                { status: 503 },
              );
            }
            return Response.json({ ok: true, note: "Checkout already paid" });
          }

          await settlePayment({
            payment: {
              id: payment.id,
              tenant_id: payment.tenant_id,
              customer_id: payment.customer_id,
              package_id: payment.package_id,
              phone: payment.phone,
              tv_device_id: payment.tv_device_id,
              expires_at: payment.expires_at,
              customer_invoice_id: payment.customer_invoice_id,
            },
            receipt,
            raw: { source: "daraja_transaction_status", result: body as unknown as Json },
          });
        } catch (error) {
          console.error("Verified manual M-Pesa payment could not be settled", error);
          try {
            await markPaymentFailed(payment.id, {
              source: "daraja_transaction_status_settlement_failed",
            });
          } catch (failureError) {
            console.error(
              "Could not restore failed status after manual settlement error",
              failureError,
            );
          }
          const { error: saveError } = await supabaseAdmin
            .from("payments")
            .update({
              manual_verification_status: "failed",
              manual_verification_error:
                "Payment verified, but access could not be activated. Try again or contact the provider.",
              raw_callback: body as unknown as Json,
            })
            .eq("id", payment.id)
            .eq("manual_verification_token_hash", tokenHash);
          if (saveError) {
            console.error("Could not save manual settlement failure", saveError);
            return Response.json({ ok: false, error: "Verification unavailable" }, { status: 503 });
          }
          return Response.json({ ok: true, note: "Payment settlement will need another attempt" });
        }

        const { data: settledPayment, error: settledPaymentError } = await supabaseAdmin
          .from("payments")
          .select("status,mpesa_receipt")
          .eq("id", payment.id)
          .eq("tenant_id", payment.tenant_id)
          .maybeSingle();
        if (settledPaymentError) {
          console.error("Could not confirm manual payment settlement", settledPaymentError);
          return Response.json({ ok: false, error: "Verification unavailable" }, { status: 503 });
        }
        if (settledPayment?.status !== "success" || settledPayment.mpesa_receipt !== receipt) {
          const { error } = await supabaseAdmin
            .from("payments")
            .update({
              manual_verification_status: "failed",
              manual_verification_error:
                "This checkout was already paid with a different receipt. Contact the provider about this extra payment.",
            })
            .eq("id", payment.id)
            .eq("manual_verification_token_hash", tokenHash);
          if (error) {
            console.error("Could not save manual duplicate payment status", error);
            return Response.json({ ok: false, error: "Verification unavailable" }, { status: 503 });
          }
          return Response.json({ ok: true, note: "Checkout already paid" });
        }

        const { error: verifyError } = await supabaseAdmin
          .from("payments")
          .update({
            manual_verification_status: "verified",
            manual_verification_error: null,
            raw_callback: body as unknown as Json,
          })
          .eq("id", payment.id)
          .eq("manual_verification_token_hash", tokenHash);
        if (verifyError) {
          console.error("Could not save verified manual M-Pesa payment", verifyError);
          return Response.json({ ok: false, error: "Verification unavailable" }, { status: 503 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
