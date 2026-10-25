import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Editing / deleting packages is limited to tenant admins (price and speeds are business
// decisions). The tenant comes from the caller's ROLE row, never from anything the client sends.
type Fail = { ok: false; error: string };

async function adminTenantOf(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "tenant_admin")
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.tenant_id ?? null;
}

const NOT_ADMIN: Fail = { ok: false, error: "Only tenant admins can change packages." };

export const PACKAGE_UNITS = ["minutes", "hours", "days", "weeks", "months"] as const;

const UpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  price: z.number().min(0).max(10_000_000),
  duration_value: z.number().int().min(1).max(100_000),
  duration_unit: z.enum(PACKAGE_UNITS),
  download_kbps: z.number().int().min(0).max(10_000_000),
  upload_kbps: z.number().int().min(0).max(10_000_000),
  active: z.boolean(),
});

/**
 * Edit a package. `kind` is deliberately not editable: customers, vouchers and router scripts
 * depend on it. Changes affect new sales and future syncs only; time already sold is unchanged.
 */
export const updatePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | Fail> => {
    const tenantId = await adminTenantOf(context.userId);
    if (!tenantId) return NOT_ADMIN;

    const { id, ...patch } = data;
    const { data: row, error } = await supabaseAdmin
      .from("packages")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("updatePackage failed", error);
      return { ok: false, error: "Could not save the package. Please try again." };
    }
    if (!row) return { ok: false, error: "Package not found." };
    return { ok: true };
  });

export type DeletePackageResult =
  | { ok: true; result: "deleted"; vouchersRemoved: number }
  | { ok: true; result: "archived"; reason: string }
  | Fail;

const DeleteSchema = z.object({ id: z.string().uuid() });

async function archive(id: string, tenantId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("packages")
    .update({ active: false })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  return !error;
}

/**
 * Delete a package. A package that was ever sold or assigned (payments, customers, redeemed
 * vouchers) is archived instead (active=false): it disappears from the portal and the voucher
 * generator but the payment history stays intact. A package that was never used is removed
 * together with its unused vouchers.
 */
export const deletePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => DeleteSchema.parse(input))
  .handler(async ({ data, context }): Promise<DeletePackageResult> => {
    const tenantId = await adminTenantOf(context.userId);
    if (!tenantId) return NOT_ADMIN;

    const { data: pkg } = await supabaseAdmin
      .from("packages")
      .select("id")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!pkg) return { ok: false, error: "Package not found." };

    const count = (table: "payments" | "customers") =>
      supabaseAdmin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("package_id", data.id)
        .eq("tenant_id", tenantId);
    const [payments, customers, redeemed] = await Promise.all([
      count("payments"),
      count("customers"),
      supabaseAdmin
        .from("vouchers")
        .select("id", { count: "exact", head: true })
        .eq("package_id", data.id)
        .eq("tenant_id", tenantId)
        .neq("status", "unused"),
    ]);

    const inUse: string[] = [];
    if ((payments.count ?? 0) > 0) inUse.push(`${payments.count} payment(s)`);
    if ((customers.count ?? 0) > 0) inUse.push(`${customers.count} customer(s)`);
    if ((redeemed.count ?? 0) > 0) inUse.push(`${redeemed.count} redeemed voucher(s)`);

    if (inUse.length > 0) {
      if (!(await archive(data.id, tenantId)))
        return { ok: false, error: "Could not archive the package." };
      return { ok: true, result: "archived", reason: inUse.join(", ") };
    }

    const { data: removed } = await supabaseAdmin
      .from("vouchers")
      .delete()
      .eq("package_id", data.id)
      .eq("tenant_id", tenantId)
      .select("id");

    const { error } = await supabaseAdmin
      .from("packages")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) {
      // Something referenced it between the check and the delete (foreign key): keep the history.
      if (error.code === "23503" && (await archive(data.id, tenantId))) {
        return { ok: true, result: "archived", reason: "it was just used" };
      }
      console.error("deletePackage failed", error);
      return { ok: false, error: "Could not delete the package." };
    }
    return { ok: true, result: "deleted", vouchersRemoved: removed?.length ?? 0 };
  });
