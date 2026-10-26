// Brings one IntaSend payment up to date by asking IntaSend for the invoice's real state.
// Called from the webhook (push) and from the portal's status poll (pull, in case a webhook is missed).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { checkPaidInvoice, invoiceVerdict } from "@/lib/intasend";
import { intasendInvoiceStatus } from "@/lib/intasend.server";
import { markPaymentFailed, settlePayment } from "@/lib/payment-settle.server";

export async function reconcileIntasendPayment(paymentId: string): Promise<{ status: string }> {
  const { data: pay } = await supabaseAdmin
    .from("payments")
    .select(
      "id,tenant_id,package_id,phone,amount,status,provider,merchant_request_id,tv_device_id,expires_at",
    )
    .eq("id", paymentId)
    .maybeSingle();
  if (!pay) return { status: "unknown" };
  if (pay.provider !== "intasend" || !pay.merchant_request_id) return { status: pay.status };
  if (pay.status === "success" || pay.status === "processing") return { status: pay.status };

  const { invoice, raw } = await intasendInvoiceStatus(pay.merchant_request_id); // throws on API failure
  const verdict = invoiceVerdict(invoice.state);

  if (verdict === "failed") {
    await markPaymentFailed(pay.id, raw as Json);
    return { status: "failed" };
  }
  if (verdict !== "paid") return { status: pay.status };

  const check = checkPaidInvoice(invoice, {
    paymentId: pay.id,
    invoiceId: pay.merchant_request_id,
    amount: Number(pay.amount),
  });
  if (!check.ok) {
    // Paid on IntaSend's side but not matching what we expected: do NOT release a voucher.
    console.error(
      `IntaSend invoice ${invoice.invoiceId} paid but rejected (${check.reason}) for payment ${pay.id}`,
    );
    return { status: pay.status };
  }

  await settlePayment({ payment: pay, receipt: invoice.receipt, raw: raw as Json });
  return { status: "success" };
}
