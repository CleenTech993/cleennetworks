// Who may open which tenant-console page. This only shapes the UI (menu + URL guard);
// the real enforcement is in the database (supabase/migrations/20261024000000_role_based_access.sql).
// Keep the two in step: a page should be reachable only by roles that can read what it needs.

export type AppRole =
  | "super_admin"
  | "tenant_admin"
  | "technician"
  | "billing_agent"
  | "support_staff"
  | "end_user";

const A: AppRole = "tenant_admin";
const T: AppRole = "technician";
const B: AppRole = "billing_agent";
const S: AppRole = "support_staff";

/** Page path prefix -> roles allowed. Anything under /tenant not listed here is admin-only. */
const PAGE_ROLES: Record<string, AppRole[]> = {
  "/tenant/routers": [A, T],
  "/tenant/hotspot": [A, T],
  "/tenant/devices": [A, T, S],
  "/tenant/pppoe": [A, T],
  "/tenant/portal": [A],
  "/tenant/packages": [A],
  "/tenant/customers": [A, T, B, S],
  "/tenant/sessions": [A, T, S],
  "/tenant/inventory": [A, T, S],
  "/tenant/payments": [A, B],
  "/tenant/sms": [A, B],
  "/tenant/tickets": [A, T, S],
  "/tenant/team": [A],
  "/tenant/settings": [A],
};

/** Roles that may see revenue figures. */
export const REVENUE_ROLES: AppRole[] = [A, B];

export function hasAnyRole(roles: readonly AppRole[], allowed: readonly AppRole[]): boolean {
  return roles.includes("super_admin") || roles.some((r) => allowed.includes(r));
}

export function canAccessPage(roles: readonly AppRole[], pathname: string): boolean {
  if (roles.includes("super_admin")) return true;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/tenant") return roles.some((r) => r !== "end_user"); // overview: any staff role
  const prefix = Object.keys(PAGE_ROLES).find((p) => path === p || path.startsWith(p + "/"));
  return hasAnyRole(roles, prefix ? PAGE_ROLES[prefix] : [A]);
}
