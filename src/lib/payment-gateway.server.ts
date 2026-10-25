// One entry point for "send the customer an M-Pesa prompt", whichever gateway is active.
import {
  normalizePhone,
  payheroConfigured,
  stkPush,
  type PlatformMpesaConfig,
} from "@/lib/mpesa.server";
import { intasendConfigured, intasendStkPush } from "@/lib/intasend.server";

export type PaymentProvider = "payhero" | "intasend";

/**
 * The gateway new payments use. IntaSend is the default: anything other than an explicit
 * "payhero" setting means IntaSend. If the preferred gateway's server secrets are missing but the
 * other one is configured, we use the other one (and log it) rather than failing every checkout;
 * only when neither is configured does it fail.
 */
export function resolveProvider(
  cfg: Pick<PlatformMpesaConfig, "active_provider">,
): PaymentProvider {
  const preferred: PaymentProvider = cfg.active_provider === "payhero" ? "payhero" : "intasend";
  const configured = (p: PaymentProvider) =>
    p === "intasend" ? intasendConfigured() : payheroConfigured();
  if (configured(preferred)) return preferred;

  const other: PaymentProvider = preferred === "intasend" ? "payhero" : "intasend";
  if (configured(other)) {
    console.warn(
      `Payment gateway "${preferred}" is selected but not configured; using "${other}" instead.`,
    );
    return other;
  }
  throw new Error("Payment gateway is not configured.");
}

export interface StartedStk {
  /** Stored in payments.checkout_request_id */
  checkoutRef: string;
  /** Stored in payments.merchant_request_id: the reference used to verify the payment later. */
  providerRef: string;
  message: string;
}

export async function startStkPush(p: {
  provider: PaymentProvider;
  cfg: PlatformMpesaConfig;
  amount: number;
  phone: string;
  /** Our payment id */
  reference: string;
  description: string;
  /** PayHero callback URL (IntaSend uses the single webhook configured in its dashboard) */
  callbackUrl: string;
}): Promise<StartedStk> {
  if (p.provider === "intasend") {
    const r = await intasendStkPush({
      amount: p.amount,
      phone: normalizePhone(p.phone),
      reference: p.reference,
    });
    return {
      checkoutRef: r.invoiceId,
      providerRef: r.invoiceId,
      message: "Check your phone for the M-Pesa prompt",
    };
  }
  const r = await stkPush({
    cfg: p.cfg,
    amount: p.amount,
    phone: p.phone,
    reference: p.reference,
    description: p.description,
    callbackUrl: p.callbackUrl,
  });
  return {
    checkoutRef: r.CheckoutRequestID,
    providerRef: r.MerchantRequestID,
    message: r.CustomerMessage,
  };
}
