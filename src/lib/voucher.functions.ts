import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { randomVoucher } from "./mpesa.server";

// Tenant staff who may mint vouchers. The tenant comes from the caller's ROLE row (like the
// team functions), never from profiles.tenant_id or from anything the client sends.
const VOUCHER_ROLES = ["tenant_admin", "billing_agent"] as const;
export const MAX_VOUCHERS_PER_BATCH = 500;

type Fail = { ok: false; error: string };
export type GenerateVouchersResult =
  { ok: true; codes: string[]; packageName: string; sellBy: string | null } | Fail;

async function voucherTenantOf(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .in("role", [...VOUCHER_ROLES])
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.tenant_id ?? null;
}

const GenerateSchema = z.object({
  packageId: z.string().uuid(),
  quantity: z.number().int().min(1).max(MAX_VOUCHERS_PER_BATCH),
  // Optional "sell by" date: the voucher can't be redeemed after it. Once redeemed, the
  // package duration starts counting (see the portal voucher endpoint).
  sellBy: z.string().datetime({ offset: true }).nullable().optional(),
});

export const generateVouchers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => GenerateSchema.parse(input))
  .handler(async ({ data, context }): Promise<GenerateVouchersResult> => {
    const tenantId = await voucherTenantOf(context.userId);
    if (!tenantId)
      return { ok: false, error: "Only tenant admins and billing agents can generate vouchers." };

    const { data: pkg } = await supabaseAdmin
      .from("packages")
      .select("id,name,kind,active,tenant_id")
      .eq("id", data.packageId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!pkg) return { ok: false, error: "Package not found." };
    if (!pkg.active) return { ok: false, error: "That package is inactive." };
    if (pkg.kind !== "hotspot" && pkg.kind !== "voucher") {
      return {
        ok: false,
        error: "Vouchers can only be generated for hotspot or voucher packages.",
      };
    }

    let sellBy: string | null = null;
    if (data.sellBy) {
      const t = new Date(data.sellBy).getTime();
      if (!Number.isFinite(t) || t <= Date.now())
        return { ok: false, error: "The sell-by date must be in the future." };
      sellBy = new Date(t).toISOString();
    }

    // (tenant_id, code) is unique. Codes are 10 chars from a 31-symbol alphabet, so a clash is
    // vanishingly rare, but top up if one ever happens rather than returning fewer than asked.
    const codes: string[] = [];
    for (let attempt = 0; attempt < 5 && codes.length < data.quantity; attempt++) {
      const batch = new Set<string>();
      while (batch.size < data.quantity - codes.length) batch.add(randomVoucher());
      const { data: inserted, error } = await supabaseAdmin
        .from("vouchers")
        .upsert(
          [...batch].map((code) => ({
            tenant_id: tenantId,
            package_id: pkg.id,
            code,
            status: "unused",
            expires_at: sellBy,
          })),
          { onConflict: "tenant_id,code", ignoreDuplicates: true },
        )
        .select("code");
      if (error) {
        console.error("generateVouchers insert failed", error);
        return { ok: false, error: "Could not save the vouchers. Please try again." };
      }
      codes.push(...(inserted ?? []).map((r) => r.code));
    }

    if (codes.length < data.quantity) {
      return {
        ok: false,
        error: `Only ${codes.length} of ${data.quantity} vouchers could be created. Please try again.`,
      };
    }
    return { ok: true, codes, packageName: pkg.name, sellBy };
  });
