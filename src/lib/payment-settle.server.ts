// Shared "this payment is really paid" step used by every gateway callback: claim the payment
// atomically, issue the voucher, mark it successful.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { expiryFrom, randomVoucher } from "@/lib/mpesa.server";

export interface SettleInput {
  payment: { id: string; tenant_id: string; package_id: string | null; phone: string | null };
  /** M-Pesa receipt number, when the gateway reports one. */
  receipt: string | null;
  /** Gateway response kept for audit (never secrets). */
  raw: Json;
}

/**
 * Only the request that flips pending|failed -> processing proceeds, so concurrent or replayed
 * callbacks cannot each issue a voucher. On any error the claim is released and the error rethrown
 * so the gateway's retry can try again instead of losing the payment.
 */
export async function settlePayment(i: SettleInput): Promise<"settled" | "already"> {
  const { payment } = i;
  const { data: claimed } = await supabaseAdmin
    .from("payments")
    .update({ status: "processing" })
    .eq("id", payment.id)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (!claimed) return "already";

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
      if (pkg?.kind === "hotspot" || pkg?.kind === "voucher") {
        voucherCode = randomVoucher();
        const { error: vErr } = await supabaseAdmin.from("vouchers").insert({
          tenant_id: payment.tenant_id,
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
        mpesa_receipt: i.receipt || null,
        phone: payment.phone || undefined,
        raw_callback: i.raw,
        voucher_code: voucherCode,
        expires_at: expiresAt,
      })
      .eq("id", payment.id);
    if (uErr) throw uErr;
  } catch (e) {
    await supabaseAdmin.from("payments").update({ status: "pending" }).eq("id", payment.id);
    throw e;
  }
  return "settled";
}

/** Records a gateway failure without ever overwriting a payment that is paid or being paid. */
export async function markPaymentFailed(paymentId: string, raw: Json): Promise<void> {
  await supabaseAdmin
    .from("payments")
    .update({ status: "failed", raw_callback: raw })
    .eq("id", paymentId)
    .in("status", ["pending", "failed"]);
}
