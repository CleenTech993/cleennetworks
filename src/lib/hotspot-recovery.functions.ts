import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { isHotspotPackageKind } from "@/lib/devices";
import { packageDurationSeconds, recoveryAllowance } from "@/lib/hotspot-recovery";

const RecoveryFieldsSchema = z.object({
  tenantId: z.string().uuid(),
  routerId: z.string().uuid(),
  outageStartedAt: z.string().datetime(),
  outageEndedAt: z.string().datetime(),
  mode: z.enum(["tracked", "manual"]),
  reason: z.string().trim().min(3).max(500),
});

const isValidOutagePeriod = (input: z.infer<typeof RecoveryFieldsSchema>) =>
  Date.parse(input.outageEndedAt) > Date.parse(input.outageStartedAt) &&
  Date.parse(input.outageEndedAt) <= Date.now() &&
  Date.parse(input.outageEndedAt) - Date.parse(input.outageStartedAt) <= 30 * 86_400_000;
const RecoveryInputSchema = RecoveryFieldsSchema.refine(isValidOutagePeriod, {
  message: "Choose an outage period within the past 30 days.",
});
const PreviewInputSchema = RecoveryInputSchema;
const ApplyInputSchema = RecoveryFieldsSchema.extend({
  paymentIds: z.array(z.string().uuid()).min(1).max(500),
}).refine(isValidOutagePeriod, { message: "Choose an outage period within the past 30 days." });

type RecoveryInput = z.infer<typeof RecoveryInputSchema>;
type RecoveryCandidate = {
  paymentId: string;
  phone: string;
  receiptSuffix: string;
  packageName: string;
  paidAt: string;
  previousExpiry: string;
  connectedSeconds: number;
  restoredSeconds: number;
  estimated: boolean;
};

async function tenantAccess(
  userId: string,
  tenantId: string,
): Promise<{ tenantId: string; userId: string }> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .in("role", ["tenant_admin", "technician"])
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Could not verify hotspot recovery access", error);
    throw new Error("Could not verify your organization access.");
  }
  if (!data?.tenant_id) throw new Error("Only tenant admins and technicians can recover access.");
  return { tenantId: data.tenant_id, userId };
}

function maskedPhone(phone: string | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "Not recorded";
}

async function eligiblePayments(
  tenantId: string,
  input: RecoveryInput,
): Promise<RecoveryCandidate[]> {
  const { data: router, error: routerError } = await supabaseAdmin
    .from("routers")
    .select("id")
    .eq("id", input.routerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (routerError) {
    console.error("Could not verify hotspot recovery router", routerError);
    throw new Error("Could not load the selected router.");
  }
  if (!router) throw new Error("The selected router does not belong to your organization.");

  const { data: payments, error: paymentsError } = await supabaseAdmin
    .from("payments")
    .select("id,phone,mpesa_receipt,package_id,router_id,created_at,expires_at,status,provider")
    .eq("tenant_id", tenantId)
    .eq("status", "success")
    .eq("provider", "daraja")
    .not("package_id", "is", null)
    .not("mpesa_receipt", "is", null)
    .not("expires_at", "is", null)
    .lte("created_at", input.outageEndedAt)
    .gt("expires_at", input.outageStartedAt)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (paymentsError) {
    console.error("Could not load payments for hotspot outage recovery", paymentsError);
    throw new Error("Could not load paid hotspot sessions.");
  }
  if ((payments?.length ?? 0) === 1000)
    throw new Error("Too many payments matched. Narrow the outage period and preview again.");
  if (!payments?.length) return [];

  const paymentIds = payments.map((payment) => payment.id);
  const packageIds = [
    ...new Set(payments.flatMap((payment) => (payment.package_id ? [payment.package_id] : []))),
  ];
  const [{ data: packages, error: packagesError }, { data: usage, error: usageError }] =
    await Promise.all([
      supabaseAdmin
        .from("packages")
        .select("id,name,kind,duration_value,duration_unit")
        .eq("tenant_id", tenantId)
        .in("id", packageIds),
      supabaseAdmin.rpc("get_hotspot_outage_usage", {
        p_tenant_id: tenantId,
        p_router_id: input.routerId,
        p_payment_ids: paymentIds,
        p_outage_started_at: input.outageStartedAt,
      }),
    ]);
  if (packagesError || usageError) {
    console.error("Could not determine hotspot recovery eligibility", {
      packagesError,
      usageError,
    });
    throw new Error("Could not calculate paid time remaining.");
  }

  const { data: recoveredItems, error: recoveredError } = await supabaseAdmin
    .from("hotspot_recovery_items")
    .select("payment_id,batch_id,created_at,new_expires_at")
    .in("payment_id", paymentIds);
  if (recoveredError) {
    console.error("Could not check previous hotspot recoveries", recoveredError);
    throw new Error("Could not check whether any sessions were already recovered.");
  }
  const recoveredBatchIds = [...new Set((recoveredItems ?? []).map((item) => item.batch_id))];
  const { data: recoveredBatches, error: batchError } = recoveredBatchIds.length
    ? await supabaseAdmin
        .from("hotspot_recovery_batches")
        .select("id,router_id,outage_started_at,outage_ended_at")
        .in("id", recoveredBatchIds)
    : { data: [], error: null };
  if (batchError) {
    console.error("Could not load previous hotspot recovery periods", batchError);
    throw new Error("Could not check whether any sessions were already recovered.");
  }

  const packageById = new Map((packages ?? []).map((pkg) => [pkg.id, pkg]));
  const usageByPayment = new Map((usage ?? []).map((row) => [row.payment_id, row]));
  const batchesById = new Map((recoveredBatches ?? []).map((batch) => [batch.id, batch]));
  const overlappingRecoveries = new Set(
    (recoveredItems ?? [])
      .filter((item) => {
        const batch = batchesById.get(item.batch_id);
        return (
          batch != null &&
          batch.outage_started_at <= input.outageEndedAt &&
          batch.outage_ended_at >= input.outageStartedAt
        );
      })
      .map((item) => item.payment_id),
  );
  const recoveryItemsByPayment = new Map<string, NonNullable<typeof recoveredItems>[number][]>();
  for (const item of recoveredItems ?? []) {
    const items = recoveryItemsByPayment.get(item.payment_id) ?? [];
    items.push(item);
    recoveryItemsByPayment.set(item.payment_id, items);
  }
  const candidates: RecoveryCandidate[] = [];

  for (const payment of payments) {
    if (!payment.package_id || !payment.mpesa_receipt || overlappingRecoveries.has(payment.id))
      continue;
    const pkg = packageById.get(payment.package_id);
    if (!pkg || !isHotspotPackageKind(pkg.kind)) continue;
    const usageRow = usageByPayment.get(payment.id);
    const routerLinked = payment.router_id === input.routerId || Boolean(usageRow?.has_usage);
    if (input.mode === "tracked" && !routerLinked) continue;
    if (input.mode === "tracked" && usageRow?.has_usage && !usageRow.was_active) continue;
    if (input.mode === "manual" && payment.router_id && payment.router_id !== input.routerId)
      continue;

    const durationSeconds = packageDurationSeconds(pkg.duration_value, pkg.duration_unit);
    if (!durationSeconds) continue;
    const connectedSeconds =
      usageRow?.has_usage && usageRow.was_active ? usageRow.connected_seconds : 0;
    const previousRecovery = (recoveryItemsByPayment.get(payment.id) ?? [])
      .filter((item) => item.created_at <= input.outageStartedAt)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
    const previousRecoveryRemaining = previousRecovery
      ? Math.floor(
          (Date.parse(previousRecovery.new_expires_at) - Date.parse(input.outageStartedAt)) / 1000,
        )
      : Number.POSITIVE_INFINITY;
    const allowance = recoveryAllowance(
      durationSeconds,
      connectedSeconds,
      previousRecoveryRemaining,
    );
    if (!allowance.eligible) continue;
    const estimated = input.mode === "manual" && !usageRow?.was_active;
    const previousExpiry = payment.expires_at;
    if (!previousExpiry) continue;

    candidates.push({
      paymentId: payment.id,
      phone: maskedPhone(payment.phone),
      receiptSuffix: payment.mpesa_receipt.slice(-4),
      packageName: pkg.name,
      paidAt: payment.created_at,
      previousExpiry,
      connectedSeconds,
      restoredSeconds: allowance.restoredSeconds,
      estimated,
    });
  }
  return candidates;
}

export const previewHotspotOutageRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof PreviewInputSchema>) => PreviewInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { tenantId } = await tenantAccess(context.userId, data.tenantId);
    return eligiblePayments(tenantId, data);
  });

export const applyHotspotOutageRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof ApplyInputSchema>) => ApplyInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { tenantId, userId } = await tenantAccess(context.userId, data.tenantId);
    const candidates = await eligiblePayments(tenantId, data);
    const byId = new Map(candidates.map((candidate) => [candidate.paymentId, candidate]));
    const selected = [...new Set(data.paymentIds)].map((paymentId) => byId.get(paymentId));
    if (selected.some((candidate) => !candidate))
      throw new Error("Some selected sessions are no longer eligible. Preview the outage again.");

    const { data: recovered, error } = await supabaseAdmin.rpc("apply_hotspot_outage_recovery", {
      p_tenant_id: tenantId,
      p_router_id: data.routerId,
      p_outage_started_at: data.outageStartedAt,
      p_outage_ended_at: data.outageEndedAt,
      p_recovery_mode: data.mode,
      p_reason: data.reason,
      p_created_by: userId,
      p_items: selected.map((candidate) => ({
        paymentId: candidate!.paymentId,
        connectedSeconds: candidate!.connectedSeconds,
        restoredSeconds: candidate!.restoredSeconds,
        estimated: candidate!.estimated,
      })),
    });
    if (error) {
      console.error("Could not apply hotspot outage recovery", error);
      throw new Error("The bulk recovery could not be completed. Refresh and try again.");
    }
    if (!recovered?.length || recovered.length !== selected.length)
      throw new Error("The recovery did not include every selected session.");
    return { batchId: recovered[0]!.batch_id, recoveredCount: recovered.length };
  });
