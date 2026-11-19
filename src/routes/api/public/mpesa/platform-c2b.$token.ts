import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CallbackSchema = z.object({
  TransID: z.string().optional(),
  TransTime: z.string().optional(),
  TransAmount: z.union([z.string(), z.number()]).optional(),
  BusinessShortCode: z.union([z.string(), z.number()]).optional(),
  ShortCode: z.union([z.string(), z.number()]).optional(),
  BillRefNumber: z.string().optional(),
  FirstName: z.string().optional(),
  MiddleName: z.string().optional(),
  LastName: z.string().optional(),
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
  const localTime = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(localTime);
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
  return new Date(localTime - 3 * 60 * 60 * 1000).toISOString();
}

export const Route = createFileRoute("/api/public/mpesa/platform-c2b/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
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
        const body = parsed.data;

        const transactionId = body.TransID?.trim();
        const shortcode = String(body.BusinessShortCode ?? body.ShortCode ?? "");
        const amount = Number(body.TransAmount);
        const occurredAt = body.TransTime ? transactionDate(body.TransTime) : null;
        if (
          !transactionId ||
          transactionId.length > 64 ||
          !/^[A-Z0-9]+$/i.test(transactionId) ||
          !/^\d{5,20}$/.test(shortcode) ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          amount > 1_000_000_000 ||
          !occurredAt ||
          (body.BillRefNumber?.length ?? 0) > 64
        ) {
          return Response.json(
            { ResultCode: 1, ResultDesc: "Invalid transaction details" },
            { status: 400 },
          );
        }

        const { data: config, error: configError } = await supabaseAdmin
          .from("platform_mpesa_config")
          .select("shortcode")
          .eq("id", 1)
          .eq("c2b_callback_token", params.token)
          .maybeSingle();
        if (configError) {
          console.error("Platform C2B configuration lookup failed", configError);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Callback temporarily unavailable" },
            { status: 503 },
          );
        }
        if (!config || config.shortcode !== shortcode) {
          return Response.json({ ResultCode: 1, ResultDesc: "Invalid callback" }, { status: 404 });
        }

        const { data: result, error: recordError } = await supabaseAdmin.rpc(
          "record_platform_c2b_transaction",
          {
            p_transaction_id: transactionId,
            p_shortcode: shortcode,
            p_bill_ref_number: body.BillRefNumber?.trim() ?? "",
            p_amount: amount,
            p_transaction_time: occurredAt,
            p_first_name: body.FirstName?.slice(0, 100) ?? null,
            p_middle_name: body.MiddleName?.slice(0, 100) ?? null,
            p_last_name: body.LastName?.slice(0, 100) ?? null,
          },
        );
        if (recordError) {
          console.error("Platform C2B transaction recording failed", recordError);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Could not record transaction" },
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
          console.error("Platform C2B returned an unexpected transaction status", result);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Could not process transaction" },
            { status: 503 },
          );
        }

        return Response.json({
          ResultCode: 0,
          ResultDesc: result === "matched" ? "Invoice payment matched" : "Transaction recorded",
        });
      },
    },
  },
});
