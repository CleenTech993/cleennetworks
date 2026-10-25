import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeMac, SAFE_CODE } from "./devices";

// Device actions. The tenant comes from the caller's ROLE row (never from the client), and writes
// go through the service role because tenant staff have read-only access to router_devices.
type Fail = { ok: false; error: string };
type Ok = { ok: true };

// Blocking a device cuts it off; unbinding lets a customer move a voucher to a new phone, which
// is a normal support request.
const BLOCK_ROLES = ["tenant_admin", "technician"];
const UNBIND_ROLES = ["tenant_admin", "technician", "support_staff"];

async function tenantOf(userId: string, roles: string[]): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .in("role", roles as never[])
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.tenant_id ?? null;
}

const BlockSchema = z.object({ mac: z.string().min(11).max(32), blocked: z.boolean() });

/** Block / unblock a device on every router of the tenant (applied by the next router sync, within ~2 min). */
export const setDeviceBlocked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input) => BlockSchema.parse(input))
  .handler(async ({ data, context }): Promise<Ok | Fail> => {
    const tenantId = await tenantOf(context.userId, BLOCK_ROLES);
    if (!tenantId)
      return { ok: false, error: "Only tenant admins and technicians can block devices." };
    const mac = normalizeMac(data.mac);
    if (!mac) return { ok: false, error: "Invalid MAC address." };

    const { data: rows, error } = await supabaseAdmin
      .from("router_devices")
      .update({ blocked: data.blocked })
      .eq("tenant_id", tenantId)
      .eq("mac", mac)
      .select("id");
    if (error) {
      console.error("setDeviceBlocked failed", error);
      return { ok: false, error: "Could not update the device. Please try again." };
    }
    if (!rows?.length) return { ok: false, error: "Device not found." };
    return { ok: true };
  });

const UnbindSchema = z.object({ code: z.string().min(1).max(64) });

/** Frees a voucher from its pinned device so the customer can log in from a different one. */
export const unbindVoucherDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input) => UnbindSchema.parse(input))
  .handler(async ({ data, context }): Promise<Ok | Fail> => {
    const tenantId = await tenantOf(context.userId, UNBIND_ROLES);
    if (!tenantId) return { ok: false, error: "You don't have permission to reset devices." };
    if (!SAFE_CODE.test(data.code)) return { ok: false, error: "Invalid voucher code." };

    const { data: row, error } = await supabaseAdmin
      .from("vouchers")
      .update({ bound_mac: null })
      .eq("tenant_id", tenantId)
      .eq("code", data.code)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("unbindVoucherDevice failed", error);
      return { ok: false, error: "Could not reset the device. Please try again." };
    }
    if (!row) return { ok: false, error: "Voucher not found." };
    return { ok: true };
  });
