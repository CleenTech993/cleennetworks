import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAal2 } from "@/lib/require-aal2";

async function requireSuperAdmin(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Only platform admins can manage platform communications.");
}

async function tenantAdminId(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "tenant_admin")
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.tenant_id) throw new Error("Only tenant admins can manage customer communications.");
  return data.tenant_id;
}

const AdminDataSchema = z.object({
  platform: z.boolean(),
  tenantId: z.string().uuid().nullable().optional(),
});

export const getCommunicationsAdminData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof AdminDataSchema>) => AdminDataSchema.parse(input))
  .handler(async ({ data, context }) => {
    let tenantId: string | null;
    let tenants: { id: string; name: string }[] = [];
    if (data.platform) {
      await requireSuperAdmin(context.userId);
      tenantId = data.tenantId ?? null;
      const { data: tenantRows, error: tenantsError } = await supabaseAdmin
        .from("tenants")
        .select("id,name")
        .order("name");
      if (tenantsError) throw tenantsError;
      tenants = tenantRows ?? [];
      if (tenantId && !tenants.some((tenant) => tenant.id === tenantId))
        throw new Error("Selected tenant was not found.");
    } else {
      tenantId = await tenantAdminId(context.userId);
    }

    const [customersResult, routersResult, announcementsResult, maintenanceResult] =
      await Promise.all([
        tenantId
          ? supabaseAdmin
              .from("customers")
              .select("id,full_name,phone,email,customer_type")
              .eq("tenant_id", tenantId)
              .order("full_name")
              .limit(1000)
          : Promise.resolve({ data: [], error: null }),
        tenantId
          ? supabaseAdmin.from("routers").select("id,name").eq("tenant_id", tenantId).order("name")
          : Promise.resolve({ data: [], error: null }),
        data.platform
          ? tenantId
            ? supabaseAdmin
                .from("customer_announcements")
                .select("id,tenant_id,customer_id,title,body,created_at,starts_at,ends_at,active")
                .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
                .order("created_at", { ascending: false })
                .limit(100)
            : supabaseAdmin
                .from("customer_announcements")
                .select("id,tenant_id,customer_id,title,body,created_at,starts_at,ends_at,active")
                .is("tenant_id", null)
                .order("created_at", { ascending: false })
                .limit(100)
          : supabaseAdmin
              .from("customer_announcements")
              .select("id,tenant_id,customer_id,title,body,created_at,starts_at,ends_at,active")
              .eq("tenant_id", tenantId!)
              .order("created_at", { ascending: false })
              .limit(100),
        data.platform
          ? tenantId
            ? supabaseAdmin
                .from("service_maintenance_windows")
                .select(
                  "id,tenant_id,router_id,title,body,mode,created_at,starts_at,ends_at,active",
                )
                .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
                .order("created_at", { ascending: false })
                .limit(100)
            : supabaseAdmin
                .from("service_maintenance_windows")
                .select(
                  "id,tenant_id,router_id,title,body,mode,created_at,starts_at,ends_at,active",
                )
                .is("tenant_id", null)
                .order("created_at", { ascending: false })
                .limit(100)
          : supabaseAdmin
              .from("service_maintenance_windows")
              .select("id,tenant_id,router_id,title,body,mode,created_at,starts_at,ends_at,active")
              .eq("tenant_id", tenantId!)
              .order("created_at", { ascending: false })
              .limit(100),
      ]);
    for (const result of [customersResult, routersResult, announcementsResult, maintenanceResult]) {
      if (result.error) throw result.error;
    }

    const customerIds = [
      ...new Set((announcementsResult.data ?? []).flatMap((item) => item.customer_id ?? [])),
    ];
    const routerIds = [
      ...new Set((maintenanceResult.data ?? []).flatMap((item) => item.router_id ?? [])),
    ];
    const [customerNames, routerNames] = await Promise.all([
      customerIds.length
        ? supabaseAdmin.from("customers").select("id,full_name,phone").in("id", customerIds)
        : Promise.resolve({ data: [], error: null }),
      routerIds.length
        ? supabaseAdmin.from("routers").select("id,name").in("id", routerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (customerNames.error) throw customerNames.error;
    if (routerNames.error) throw routerNames.error;

    const customerLabel = new Map(
      (customerNames.data ?? []).map((customer) => [
        customer.id,
        customer.full_name || customer.phone || "Customer",
      ]),
    );
    const routerLabel = new Map((routerNames.data ?? []).map((router) => [router.id, router.name]));
    return {
      tenantId,
      tenants,
      customers: customersResult.data ?? [],
      routers: routersResult.data ?? [],
      announcements: (announcementsResult.data ?? []).map((item) => ({
        ...item,
        customerLabel: item.customer_id
          ? (customerLabel.get(item.customer_id) ?? "Customer")
          : null,
      })),
      maintenance: (maintenanceResult.data ?? []).map((item) => ({
        ...item,
        routerLabel: item.router_id ? (routerLabel.get(item.router_id) ?? "Site") : null,
      })),
    };
  });

const AnnouncementSchema = z.object({
  platform: z.boolean(),
  tenantId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  endsAt: z.string().datetime().nullable().optional(),
});

export const createCustomerAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof AnnouncementSchema>) => AnnouncementSchema.parse(input))
  .handler(async ({ data, context }) => {
    let tenantId: string | null;
    if (data.platform) {
      await requireSuperAdmin(context.userId);
      tenantId = data.tenantId ?? null;
    } else {
      tenantId = await tenantAdminId(context.userId);
    }
    if (data.customerId && !tenantId)
      throw new Error("Choose a tenant before sending a message to one customer.");
    if (data.customerId) {
      const { data: customer, error } = await supabaseAdmin
        .from("customers")
        .select("id")
        .eq("id", data.customerId)
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      if (error) throw error;
      if (!customer) throw new Error("Selected customer does not belong to this tenant.");
    }
    const { error } = await supabaseAdmin.from("customer_announcements").insert({
      tenant_id: tenantId,
      customer_id: data.customerId ?? null,
      title: data.title,
      body: data.body,
      created_by: context.userId,
      ends_at: data.endsAt ?? null,
    });
    if (error) throw error;
    return { sent: true };
  });

const MaintenanceSchema = z.object({
  platform: z.boolean(),
  routerId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  mode: z.enum(["notice", "block_new", "block_all"]),
  endsAt: z.string().datetime().nullable().optional(),
});

export const createMaintenanceWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof MaintenanceSchema>) => MaintenanceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = data.platform
      ? (await requireSuperAdmin(context.userId), null)
      : await tenantAdminId(context.userId);
    if (data.platform && data.routerId)
      throw new Error("Platform maintenance applies to the whole platform, not one tenant site.");
    if (data.routerId) {
      const { data: router, error } = await supabaseAdmin
        .from("routers")
        .select("id")
        .eq("id", data.routerId)
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      if (error) throw error;
      if (!router) throw new Error("Selected site does not belong to this tenant.");
    }
    const { error } = await supabaseAdmin.from("service_maintenance_windows").insert({
      tenant_id: tenantId,
      router_id: data.routerId ?? null,
      title: data.title,
      body: data.body,
      mode: data.mode,
      created_by: context.userId,
      ends_at: data.endsAt ?? null,
    });
    if (error) throw error;
    return { created: true };
  });

const DeactivateSchema = z.object({
  platform: z.boolean(),
  id: z.string().uuid(),
  kind: z.enum(["announcement", "maintenance"]),
});

export const deactivateCommunication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof DeactivateSchema>) => DeactivateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = data.platform
      ? (await requireSuperAdmin(context.userId), null)
      : await tenantAdminId(context.userId);
    const table =
      data.kind === "announcement" ? "customer_announcements" : "service_maintenance_windows";
    let query = supabaseAdmin.from(table).update({ active: false }).eq("id", data.id);
    if (data.platform) {
      if (tenantId) throw new Error("Invalid platform communication scope.");
    } else {
      query = query.eq("tenant_id", tenantId!);
    }
    const { data: row, error } = await query.select("id").maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("This communication was not found in your scope.");
    return { deactivated: true };
  });
