// Shared "this payment is really paid" step used by every gateway callback: claim the payment
// atomically, issue the voucher, mark it successful.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { expiryFrom, randomVoucher } from "@/lib/mpesa.server";
import { renewedExpiry } from "@/lib/pppoe";

export interface SettleInput {
  payment: {
    id: string;
    tenant_id: string;
    customer_id: string | null;
    package_id: string | null;
    phone: string | null;
    /** Set when the payment renews a smart TV instead of buying a voucher. */
    tv_device_id: string | null;
    /** Expiry already computed by an earlier attempt, so a retry never extends the TV twice. */
    expires_at: string | null;
  };
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
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("payments")
    .update({ status: "processing" })
    .eq("id", payment.id)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return "already";

  try {
    let voucherCode: string | null = null;
    let expiresAt: string | null = null;
    if (payment.package_id) {
      const { data: pkg, error: packageError } = await supabaseAdmin
        .from("packages")
        .select("kind,duration_value,duration_unit")
        .eq("id", payment.package_id)
        .maybeSingle();
      if (packageError) throw packageError;
      if (!pkg) throw new Error("Payment package not found");
      if (pkg?.duration_value && pkg?.duration_unit) {
        expiresAt = expiryFrom(pkg.duration_value, pkg.duration_unit);
      }
      if (pkg.kind === "hotspot_tv") {
        if (!payment.tv_device_id) throw new Error("Phone + TV payment has no registered TV");
        if (!pkg.duration_value || !pkg.duration_unit)
          throw new Error("Phone + TV package has no duration");

        const { data: dev, error: deviceError } = await supabaseAdmin
          .from("tv_devices")
          .select("id,status")
          .eq("id", payment.tv_device_id)
          .eq("tenant_id", payment.tenant_id)
          .maybeSingle();
        if (deviceError) throw deviceError;
        if (!dev) throw new Error("TV device not found");

        const { data: savedPayment, error: paymentLookupError } = await supabaseAdmin
          .from("payments")
          .select("voucher_code,expires_at")
          .eq("id", payment.id)
          .maybeSingle();
        if (paymentLookupError) throw paymentLookupError;
        expiresAt =
          savedPayment?.expires_at ??
          payment.expires_at ??
          expiryFrom(pkg.duration_value, pkg.duration_unit);
        const { error: expiryError } = await supabaseAdmin
          .from("payments")
          .update({ expires_at: expiresAt })
          .eq("id", payment.id);
        if (expiryError) throw expiryError;

        const { data: existingVoucher, error: voucherLookupError } = await supabaseAdmin
          .from("vouchers")
          .select("code")
          .eq("payment_id", payment.id)
          .maybeSingle();
        if (voucherLookupError) throw voucherLookupError;
        voucherCode = existingVoucher?.code ?? savedPayment?.voucher_code ?? randomVoucher();
        if (!existingVoucher) {
          const { error: voucherError } = await supabaseAdmin.from("vouchers").insert({
            tenant_id: payment.tenant_id,
            package_id: payment.package_id,
            code: voucherCode,
            payment_id: payment.id,
            expires_at: expiresAt,
          });
          if (voucherError) throw voucherError;
        }
        const { error: voucherSaveError } = await supabaseAdmin
          .from("payments")
          .update({ voucher_code: voucherCode })
          .eq("id", payment.id);
        if (voucherSaveError) throw voucherSaveError;

        // A combined purchase uses one fixed expiry for both entitlements; it does not extend an
        // earlier TV expiry independently of the phone voucher.
        if (dev.status !== "blocked") {
          const { error: tvUpdateError } = await supabaseAdmin
            .from("tv_devices")
            .update({
              status: "active",
              expires_at: expiresAt,
              package_id: payment.package_id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", dev.id);
          if (tvUpdateError) throw tvUpdateError;
        }
      } else if (payment.tv_device_id) {
        // Smart TV: extend the device's access instead of minting a voucher. The new expiry is
        // remembered on the payment first so a retried callback reuses it rather than extending twice.
        if (!pkg?.duration_value || !pkg?.duration_unit)
          throw new Error("TV package has no duration");
        const { data: dev } = await supabaseAdmin
          .from("tv_devices")
          .select("id,status,expires_at")
          .eq("id", payment.tv_device_id)
          .eq("tenant_id", payment.tenant_id)
          .maybeSingle();
        if (!dev) throw new Error("TV device not found");
        expiresAt =
          payment.expires_at ??
          renewedExpiry(dev.expires_at, pkg.duration_value, pkg.duration_unit);
        if (!payment.expires_at) {
          const { error } = await supabaseAdmin
            .from("payments")
            .update({ expires_at: expiresAt })
            .eq("id", payment.id);
          if (error) throw error;
        }
        if (dev.status !== "blocked") {
          const { error: dErr } = await supabaseAdmin
            .from("tv_devices")
            .update({
              status: "active",
              expires_at: expiresAt,
              package_id: payment.package_id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", dev.id);
          if (dErr) throw dErr;
        }
      } else if (pkg?.kind === "pppoe") {
        if (!payment.customer_id || !pkg.duration_value || !pkg.duration_unit) {
          throw new Error("PPPoE payment is missing its account or package duration");
        }
        const { data: customer, error: customerError } = await supabaseAdmin
          .from("customers")
          .select("id,expires_at")
          .eq("id", payment.customer_id)
          .eq("tenant_id", payment.tenant_id)
          .eq("customer_type", "pppoe")
          .maybeSingle();
        if (customerError) throw customerError;
        if (!customer) throw new Error("PPPoE customer account not found");

        expiresAt =
          payment.expires_at ??
          renewedExpiry(customer.expires_at, pkg.duration_value, pkg.duration_unit);
        if (!payment.expires_at) {
          const { error: expiryError } = await supabaseAdmin
            .from("payments")
            .update({ expires_at: expiresAt })
            .eq("id", payment.id);
          if (expiryError) throw expiryError;
        }
        const { error: customerUpdateError } = await supabaseAdmin
          .from("customers")
          .update({
            package_id: payment.package_id,
            expires_at: expiresAt,
            status: "active",
          })
          .eq("id", customer.id)
          .eq("tenant_id", payment.tenant_id);
        if (customerUpdateError) throw customerUpdateError;
      } else if (pkg?.kind === "hotspot" || pkg?.kind === "voucher") {
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
  const { error } = await supabaseAdmin
    .from("payments")
    .update({ status: "failed", raw_callback: raw })
    .eq("id", paymentId)
    .in("status", ["pending", "failed"]);
  if (error) throw error;
}
