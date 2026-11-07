import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CallbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      CheckoutRequestID: z.string().min(1).max(200),
      ResultCode: z.union([z.string(), z.number()]),
      ResultDesc: z.string().optional(),
      CallbackMetadata: z
        .object({
          Item: z.array(
            z.object({
              Name: z.string(),
              Value: z.union([z.string(), z.number()]).optional(),
            }),
          ),
        })
        .optional(),
    }),
  }),
});

function transactionDate(value: string): string | null {
  if (!/^\d{14}$/.test(value)) return null;
  const [year, month, day, hour, minute, second] = [
    value.slice(0, 4),
    value.slice(4, 6),
    value.slice(6, 8),
    value.slice(8, 10),
    value.slice(10, 12),
    value.slice(12, 14),
  ].map(Number);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(timestamp);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }
  return new Date(timestamp - 3 * 60 * 60 * 1000).toISOString();
}

export const Route = createFileRoute("/api/public/mpesa/platform-stk/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { token: string } }) => {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return Response.json(
            { ResultCode: 1, ResultDesc: "Invalid callback body" },
            { status: 400 },
          );
        }
        const parsed = CallbackSchema.safeParse(payload);
        if (!parsed.success) {
          return Response.json(
            { ResultCode: 1, ResultDesc: "Invalid callback body" },
            { status: 400 },
          );
        }

        const { stkCallback } = parsed.data.Body;
        const { data: config, error: configError } = await supabaseAdmin
          .from("platform_mpesa_config")
          .select("shortcode")
          .eq("id", 1)
          .eq("c2b_callback_token", params.token)
          .maybeSingle();
        if (configError) {
          console.error("Platform STK configuration lookup failed", configError);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Callback temporarily unavailable" },
            { status: 503 },
          );
        }
        if (!config?.shortcode) {
          return Response.json({ ResultCode: 1, ResultDesc: "Invalid callback" }, { status: 404 });
        }

        if (String(stkCallback.ResultCode) !== "0") {
          const { error } = await supabaseAdmin
            .from("platform_stk_payments")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("checkout_request_id", stkCallback.CheckoutRequestID)
            .eq("status", "pending");
          if (error) {
            console.error("Platform STK failure callback could not be recorded", error);
            return Response.json(
              { ResultCode: 1, ResultDesc: "Could not record payment result" },
              { status: 503 },
            );
          }
          return Response.json({ ResultCode: 0, ResultDesc: "Payment result recorded" });
        }

        const items = stkCallback.CallbackMetadata?.Item ?? [];
        const value = (name: string) => items.find((item) => item.Name === name)?.Value;
        const transactionId = value("MpesaReceiptNumber");
        const amount = Number(value("Amount"));
        const transactionTimeValue = String(value("TransactionDate") ?? "");
        const occurredAt = transactionDate(transactionTimeValue);
        if (
          typeof transactionId !== "string" ||
          !/^[A-Z0-9]{6,40}$/i.test(transactionId) ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          !occurredAt
        ) {
          console.error("Platform STK success callback has invalid transaction metadata");
          return Response.json(
            { ResultCode: 1, ResultDesc: "Invalid transaction details" },
            { status: 503 },
          );
        }

        const { data: result, error } = await supabaseAdmin.rpc("record_platform_stk_transaction", {
          p_checkout_request_id: stkCallback.CheckoutRequestID,
          p_transaction_id: transactionId,
          p_shortcode: config.shortcode,
          p_amount: amount,
          p_transaction_time: occurredAt,
        });
        if (error) {
          console.error("Platform STK transaction recording failed", error);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Could not record payment" },
            { status: 503 },
          );
        }
        if (
          ![
            "matched",
            "unmatched",
            "amount_mismatch",
            "invoice_already_paid",
            "duplicate",
          ].includes(result ?? "")
        ) {
          console.error("Platform STK returned an unexpected transaction status", result);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Could not process payment" },
            { status: 503 },
          );
        }
        return Response.json({ ResultCode: 0, ResultDesc: "Payment result recorded" });
      },
    },
  },
});
