import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Tenant staff who may mint vouchers. The tenant comes from the caller's ROLE row (like the
// team functions), never from profiles.tenant_id or from anything the client sends.
const VOUCHER_ROLES = ["tenant_admin", "billing_agent"] as const;
export const MAX_VOUCHERS_PER_BATCH = 500;

type Fail = { ok: false; error: string };

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

// ---------------------------------------------------------------------------
// Delete / edit existing vouchers
// ---------------------------------------------------------------------------

const DeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_VOUCHERS_PER_BATCH),
});

/**
 * Delete vouchers. The router sync rebuilds its voucher hotspot users from this table every
 * couple of minutes, so a deleted code stops working on the routers within about 2 minutes.
 */
export const deleteVouchers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input) => DeleteSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; deleted: number } | Fail> => {
    const tenantId = await voucherTenantOf(context.userId);
    if (!tenantId)
      return { ok: false, error: "Only tenant admins and billing agents can delete vouchers." };

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
  .middleware([requireSupabaseAal2])
  .inputValidator((input) => UpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | Fail> => {
    const tenantId = await voucherTenantOf(context.userId);
    if (!tenantId)
      return { ok: false, error: "Only tenant admins and billing agents can edit vouchers." };

    const { data: v } = await supabaseAdmin
      .from("vouchers")
      .select("id,status,package_id")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!v) return { ok: false, error: "Voucher not found." };

    const patch: { package_id?: string; expires_at?: string | null } = {};

    if (data.packageId && data.packageId !== v.package_id) {
      if (v.status !== "unused")
        return { ok: false, error: "A redeemed voucher can't be moved to another package." };
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
        if (v.status !== "unused")
          return { ok: false, error: "A redeemed voucher must keep an expiry date." };
        patch.expires_at = null;
      } else {
        const t = new Date(data.expiresAt).getTime();
        if (!Number.isFinite(t) || t <= Date.now())
          return { ok: false, error: "The date must be in the future." };
        patch.expires_at = new Date(t).toISOString();
      }
    }

    if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to change." };

    const { error } = await supabaseAdmin
      .from("vouchers")
      .update(patch)
      .eq("id", v.id)
      .eq("tenant_id", tenantId);
    if (error) {
      console.error("updateVoucher failed", error);
      return { ok: false, error: "Could not save the voucher. Please try again." };
    }
    return { ok: true };
  });
