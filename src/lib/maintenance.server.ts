import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MaintenanceMode = "notice" | "block_new" | "block_all";

export type MaintenanceNotice = {
  id: string;
  title: string;
  body: string;
  mode: MaintenanceMode;
  starts_at: string;
  ends_at: string | null;
};

export async function activePortalMaintenance(
  tenantId: string,
  routerId: string | null,
): Promise<MaintenanceNotice[]> {
  if (routerId) {
    const { data: router, error } = await supabaseAdmin
      .from("routers")
      .select("id")
      .eq("id", routerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!router) throw new Error("Invalid captive portal site.");
  }
  return activeMaintenance(tenantId, routerId);
}

export async function activeMaintenance(
  tenantId: string,
  routerId: string | null,
): Promise<MaintenanceNotice[]> {
  const now = new Date().toISOString();
  let query = supabaseAdmin
    .from("service_maintenance_windows")
    .select("id,title,body,mode,starts_at,ends_at")
    .eq("active", true)
    .lte("starts_at", now)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
  query = routerId
    ? query.or(`router_id.is.null,router_id.eq.${routerId}`)
    : query.is("router_id", null);
  const { data, error } = await query.order("starts_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MaintenanceNotice[];
}

export function blocksNewConnections(notices: MaintenanceNotice[]): boolean {
  return notices.some((notice) => notice.mode === "block_new" || notice.mode === "block_all");
}

export function blocksAllConnections(notices: MaintenanceNotice[]): boolean {
  return notices.some((notice) => notice.mode === "block_all");
}

export function maintenanceMessage(notices: MaintenanceNotice[]): string {
  const notice = notices.find((item) => item.mode !== "notice");
  return notice
    ? `New connections are paused during maintenance: ${notice.title}.`
    : "New connections are temporarily unavailable during maintenance.";
}

export async function portalMaintenanceBlock(
  tenantId: string,
  routerId: string | null,
): Promise<string | null> {
  const notices = await activePortalMaintenance(tenantId, routerId);
  return blocksNewConnections(notices) ? maintenanceMessage(notices) : null;
}
