import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LOCK_DURATION_MS = 3 * 60_000;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

type InventorySetting = {
  id: string;
  tenant_id: string;
  router_id: string;
  package_id: string;
  minimum_stock: number;
  target_stock: number;
  maximum_stock: number;
  batch_size: number;
};

export type ReplenishmentResult = {
  settingId: string;
  created: number;
  available: number;
  syncing: number;
  skipped: boolean;
};

function randomVoucherCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte & 31]).join("");
}

async function replenishStock(setting: InventorySetting): Promise<ReplenishmentResult> {
  const now = new Date().toISOString();
  const [availableQuery, syncingQuery] = await Promise.all([
    supabaseAdmin
      .from("vouchers")
      .select("id")
      .eq("tenant_id", setting.tenant_id)
      .eq("router_id", setting.router_id)
      .eq("package_id", setting.package_id)
      .eq("status", "unused")
      .eq("sync_status", "available")
      .is("payment_id", null)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .limit(setting.maximum_stock + 1),
    supabaseAdmin
      .from("vouchers")
      .select("id")
      .eq("tenant_id", setting.tenant_id)
      .eq("router_id", setting.router_id)
      .eq("package_id", setting.package_id)
      .eq("status", "unused")
      .eq("sync_status", "pending")
      .is("payment_id", null)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .limit(setting.maximum_stock + 1),
  ]);
  if (availableQuery.error) throw availableQuery.error;
  if (syncingQuery.error) throw syncingQuery.error;

  const available = availableQuery.data?.length ?? 0;
  const syncing = syncingQuery.data?.length ?? 0;
  const total = available + syncing;
  if (available >= setting.minimum_stock || total >= setting.target_stock) {
    return { settingId: setting.id, created: 0, available, syncing, skipped: false };
  }

  const quantity = Math.min(
    setting.batch_size,
    setting.target_stock - total,
    setting.maximum_stock - total,
  );
  if (quantity <= 0) {
    return { settingId: setting.id, created: 0, available, syncing, skipped: false };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const codes = new Set<string>();
    while (codes.size < quantity) codes.add(randomVoucherCode());
    const { data, error } = await supabaseAdmin.rpc("insert_presynced_vouchers", {
      p_setting_id: setting.id,
      p_codes: [...codes],
    });
    if (!error) {
      const created = Number(data ?? 0);
      return { settingId: setting.id, created, available, syncing, skipped: created === 0 };
    }
    if (error.code !== "23505" || attempt === 2) throw error;
  }

  throw new Error("Could not create a unique voucher batch.");
}

async function replenishOne(setting: InventorySetting): Promise<ReplenishmentResult> {
  const lockUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
  const { data: locked, error: lockError } = await supabaseAdmin
    .from("voucher_inventory_settings")
    .update({ replenishment_lock_until: lockUntil, updated_at: new Date().toISOString() })
    .eq("id", setting.id)
    .eq("enabled", true)
    .or(`replenishment_lock_until.is.null,replenishment_lock_until.lt.${new Date().toISOString()}`)
    .select("id")
    .maybeSingle();
  if (lockError) throw lockError;
  if (!locked) {
    return { settingId: setting.id, created: 0, available: 0, syncing: 0, skipped: true };
  }

  let result: ReplenishmentResult | undefined;
  let failure: unknown;
  try {
    result = await replenishStock(setting);
  } catch (error) {
    failure = error;
  }

  const { error: unlockError } = await supabaseAdmin
    .from("voucher_inventory_settings")
    .update({ replenishment_lock_until: null })
    .eq("id", setting.id)
    .eq("replenishment_lock_until", lockUntil);
  if (unlockError) {
    console.error("Could not release voucher replenishment lock", unlockError);
    if (!failure) throw unlockError;
  }
  if (failure) throw failure;
  if (!result) throw new Error("Voucher replenishment did not return a result.");
  return result;
}

export async function replenishVoucherInventory(
  settingId?: string,
): Promise<ReplenishmentResult[]> {
  let query = supabaseAdmin
    .from("voucher_inventory_settings")
    .select("id,tenant_id,router_id,package_id,minimum_stock,target_stock,maximum_stock,batch_size")
    .eq("enabled", true)
    .order("updated_at", { ascending: true })
    .limit(100);
  if (settingId) query = query.eq("id", settingId);

  const { data, error } = await query;
  if (error) throw error;

  const results: ReplenishmentResult[] = [];
  for (const setting of data ?? []) {
    results.push(await replenishOne(setting));
  }
  return results;
}
