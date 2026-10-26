// Brings one IntaSend payment up to date by asking IntaSend for the invoice's real state.
// Called from the webhook (push) and from the portal's status poll (pull, in case a webhook is missed).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadGatewaySecrets } from "@/lib/gateway-secrets.server";
import type { Json } from "@/integrations/supabase/types";
import { checkPaidInvoice, invoiceVerdict } from "@/lib/intasend";
import { intasendConfigured, intasendInvoiceStatus } from "@/lib/intasend.server";
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

export interface SweepResult {
  checked: number;
  settled: number;
  failed: number;
  errors: number;
}

/**
 * Confirms recent IntaSend payments that are still "pending" by asking IntaSend directly, so a payment
 * is settled even if the webhook never arrives AND the customer closed the portal page. Only payments
 * old enough to have been answered (minAgeSec) and young enough to still matter (maxAgeHours) are
 * checked, oldest first, a few at a time. Each one is verified exactly like the webhook path
 * (reconcileIntasendPayment), so amount, invoice and reference are still checked before a voucher is issued.
 */
export async function sweepPendingIntasendPayments(
  opts: { limit?: number; minAgeSec?: number; maxAgeHours?: number } = {},
): Promise<SweepResult> {
  const out: SweepResult = { checked: 0, settled: 0, failed: 0, errors: 0 };
  await loadGatewaySecrets();
  if (!intasendConfigured()) return out;

  const now = Date.now();
  const { data } = await supabaseAdmin
    .from("payments")
    .select("id")
    .eq("provider", "intasend")
    .eq("status", "pending")
    .not("merchant_request_id", "is", null)
    .gte("created_at", new Date(now - (opts.maxAgeHours ?? 24) * 3_600_000).toISOString())
    .lte("created_at", new Date(now - (opts.minAgeSec ?? 20) * 1000).toISOString())
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 5);

  for (const row of data ?? []) {
    out.checked += 1;
    try {
      const r = await reconcileIntasendPayment(row.id as string);
      if (r.status === "success") out.settled += 1;
      else if (r.status === "failed") out.failed += 1;
    } catch (e) {
      out.errors += 1;
      console.error(
        "IntaSend sweep: could not check payment",
        row.id,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return out;
}

let lastSweepAt = 0;
/** At most once per `everyMs` per server instance, never longer than `budgetMs`, never throws. */
export async function sweepIntasendIfDue(everyMs = 45_000, budgetMs = 4_000): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < everyMs) return;
  lastSweepAt = now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sweepPendingIntasendPayments({ limit: 3 }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
  } catch (e) {
    console.error("IntaSend sweep failed", e instanceof Error ? e.message : e);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Test helper. */
export function resetSweepThrottle(): void {
  lastSweepAt = 0;
}
