import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { replenishVoucherInventory } from "@/lib/voucher-inventory.server";

type Fail = { ok: false; error: string };
const VOUCHER_ROLES = ["tenant_admin"] as const;

async function adminTenantOf(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .in("role", [...VOUCHER_ROLES])
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Could not verify voucher inventory administrator", error);
    throw new Error("Could not verify permissions.");
  }
  return data?.tenant_id ?? null;
}

const InventorySchema = z
  .object({
    routerId: z.string().uuid(),
    packageId: z.string().uuid(),
    enabled: z.boolean(),
    minimumStock: z.number().int().min(0).max(500),
    targetStock: z.number().int().min(1).max(500),
    maximumStock: z.number().int().min(1).max(500),
    batchSize: z.number().int().min(1).max(500),
  })
  .refine(
    (settings) =>
      settings.minimumStock <= settings.targetStock &&
      settings.targetStock <= settings.maximumStock,
    { message: "Stock levels must satisfy minimum ≤ target ≤ maximum." },
  );

export const saveVoucherInventorySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: unknown) => InventorySchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; id: string } | Fail> => {
    const tenantId = await adminTenantOf(context.userId);
    if (!tenantId)
      return { ok: false, error: "Only tenant admins can configure voucher pre-sync." };

    const [routerResult, packageResult] = await Promise.all([
      supabaseAdmin
        .from("routers")
        .select("id,vendor")
        .eq("id", data.routerId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabaseAdmin
        .from("packages")
        .select("id,kind,active")
        .eq("id", data.packageId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);
    if (routerResult.error || packageResult.error) {
      console.error(
        "Could not validate voucher inventory configuration",
        routerResult.error ?? packageResult.error,
      );
      return { ok: false, error: "Could not validate this router and package." };
    }
    if (routerResult.data?.vendor !== "mikrotik") {
      return { ok: false, error: "Pre-sync currently supports MikroTik routers only." };
    }
    if (
      !packageResult.data ||
      !packageResult.data.active ||
      !["hotspot", "voucher"].includes(packageResult.data.kind)
    ) {
      return { ok: false, error: "Choose an active hotspot or voucher package." };
    }

    const { data: settingId, error } = await supabaseAdmin.rpc("save_voucher_inventory_settings", {
      p_tenant_id: tenantId,
      p_router_id: data.routerId,
      p_package_id: data.packageId,
      p_enabled: data.enabled,
      p_minimum_stock: data.minimumStock,
      p_target_stock: data.targetStock,
      p_maximum_stock: data.maximumStock,
      p_batch_size: data.batchSize,
    });
    if (error || !settingId) {
      console.error("Could not save voucher inventory settings", error);
      return { ok: false, error: "Could not save voucher inventory settings." };
    }

    return { ok: true, id: settingId };
  });

const GenerateSchema = z.object({ settingId: z.string().uuid() });

export const generateVoucherInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: unknown) => GenerateSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; created: number; available: number; syncing: number } | Fail> => {
      const tenantId = await adminTenantOf(context.userId);
      if (!tenantId) return { ok: false, error: "Only tenant admins can generate voucher stock." };

      const { data: setting, error: settingError } = await supabaseAdmin
        .from("voucher_inventory_settings")
        .select("id")
        .eq("id", data.settingId)
        .eq("tenant_id", tenantId)
        .eq("enabled", true)
        .maybeSingle();
      if (settingError) {
        console.error("Could not load voucher inventory settings", settingError);
        return { ok: false, error: "Could not load voucher inventory settings." };
      }
      if (!setting)
        return { ok: false, error: "Enable pre-sync for this router and package first." };

      try {
        const [result] = await replenishVoucherInventory(setting.id);
        return {
          ok: true,
          created: result?.created ?? 0,
          available: result?.available ?? 0,
          syncing: result?.syncing ?? 0,
        };
      } catch (error) {
        console.error("Manual voucher inventory replenishment failed", error);
        return { ok: false, error: "Could not replenish voucher inventory. Please retry." };
      }
    },
  );
