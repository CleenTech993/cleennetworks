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
  | { ok: true; codes: string[]; packageName: string; sellBy: string | null }
  | Fail;

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
    if (!tenantId) return { ok: false, error: "Only tenant admins and billing agents can generate vouchers." };

    const { data: pkg } = await supabaseAdmin
      .from("packages")
      .select("id,name,kind,active,tenant_id")
      .eq("id", data.packageId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!pkg) return { ok: false, error: "Package not found." };
    if (!pkg.active) return { ok: false, error: "That package is inactive." };
    if (pkg.kind !== "hotspot" && pkg.kind !== "voucher") {
      return { ok: false, error: "Vouchers can only be generated for hotspot or voucher packages." };
    }

    let sellBy: string | null = null;
    if (data.sellBy) {
      const t = new Date(data.sellBy).getTime();
      if (!Number.isFinite(t) || t <= Date.now()) return { ok: false, error: "The sell-by date must be in the future." };
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
      return { ok: false, error: `Only ${codes.length} of ${data.quantity} vouchers could be created. Please try again.` };
    }
    return { ok: true, codes, packageName: pkg.name, sellBy };
  });

// ---------------------------------------------------------------------------
// Delete / edit existing vouchers
// ---------------------------------------------------------------------------

const DeleteSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(MAX_VOUCHERS_PER_BATCH) });

/**
 * Delete vouchers. The router sync rebuilds its voucher hotspot users from this table every
 * couple of minutes, so a deleted code stops working on the routers within about 2 minutes.
 */
export const deleteVouchers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => DeleteSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; deleted: number } | Fail> => {
    const tenantId = await voucherTenantOf(context.userId);
    if (!tenantId) return { ok: false, error: "Only tenant admins and billing agents can delete vouchers." };

    const { data: removed, error } = await supabaseAdmin
      .from("vouchers")
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", data.ids)
      .select("id");
    if (error) {
      console.error("deleteVouchers failed", error);
      return { ok: false, error: "Could not delete the vouchers. Please try again." };
    }
    return { ok: true, deleted: removed?.length ?? 0 };
  });

const UpdateSchema = z.object({
  id: z.string().uuid(),
  // Only unused vouchers can be moved to another package.
  packageId: z.string().uuid().optional(),
  // Unused voucher: "sell by" date (null = none). Used voucher: when its access ends.
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const updateVoucher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | Fail> => {
    const tenantId = await voucherTenantOf(context.userId);
    if (!tenantId) return { ok: false, error: "Only tenant admins and billing agents can edit vouchers." };

    const { data: v } = await supabaseAdmin
      .from("vouchers")
      .select("id,status,package_id")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!v) return { ok: false, error: "Voucher not found." };

    const patch: { package_id?: string; expires_at?: string | null } = {};

    if (data.packageId && data.packageId !== v.package_id) {
      if (v.status !== "unused") return { ok: false, error: "A redeemed voucher can't be moved to another package." };
      const { data: pkg } = await supabaseAdmin
        .from("packages")
        .select("id,kind")
        .eq("id", data.packageId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!pkg || (pkg.kind !== "hotspot" && pkg.kind !== "voucher")) {
        return { ok: false, error: "Choose a hotspot or voucher package." };
      }
      patch.package_id = pkg.id;
    }

    if (data.expiresAt !== undefined) {
      if (data.expiresAt === null) {
        if (v.status !== "unused") return { ok: false, error: "A redeemed voucher must keep an expiry date." };
        patch.expires_at = null;
      } else {
        const t = new Date(data.expiresAt).getTime();
        if (!Number.isFinite(t) || t <= Date.now()) return { ok: false, error: "The date must be in the future." };
        patch.expires_at = new Date(t).toISOString();
      }
    }

    if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to change." };

    const { error } = await supabaseAdmin
      .from("vouchers").update(patch).eq("id", v.id).eq("tenant_id", tenantId);
    if (error) {
      console.error("updateVoucher failed", error);
      return { ok: false, error: "Could not save the voucher. Please try again." };
    }
    return { ok: true };
  });
