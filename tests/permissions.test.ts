import { describe, expect, it } from "vitest";
import { canAccessPage, hasAnyRole, REVENUE_ROLES } from "../src/lib/permissions";

const pages = ["/tenant", "/tenant/routers", "/tenant/routers/abc", "/tenant/hotspot", "/tenant/pppoe", "/tenant/portal",
  "/tenant/packages", "/tenant/customers", "/tenant/sessions", "/tenant/payments", "/tenant/sms", "/tenant/tickets",
  "/tenant/team", "/tenant/settings"] as const;
const open = (roles: Parameters<typeof canAccessPage>[0]) => pages.filter((p) => canAccessPage(roles, p));

describe("tenant console page access", () => {
  it("tenant admin sees everything", () => expect(open(["tenant_admin"])).toEqual([...pages]));
  it("super admin sees everything", () => expect(open(["super_admin"])).toEqual([...pages]));
  it("technician: network + customers + support, no money, no settings/team", () =>
    expect(open(["technician"])).toEqual(["/tenant", "/tenant/routers", "/tenant/routers/abc", "/tenant/hotspot",
      "/tenant/pppoe", "/tenant/customers", "/tenant/sessions", "/tenant/tickets"]));
  it("billing agent: customers + payments + notifications only", () =>
    expect(open(["billing_agent"])).toEqual(["/tenant", "/tenant/customers", "/tenant/payments", "/tenant/sms"]));
  it("support staff: customers, sessions, tickets only", () =>
    expect(open(["support_staff"])).toEqual(["/tenant", "/tenant/customers", "/tenant/sessions", "/tenant/tickets"]));
  it("multiple roles combine", () =>
    expect(canAccessPage(["technician", "billing_agent"], "/tenant/payments")).toBe(true));
  it("unknown pages and trailing slashes are handled safely", () => {
    expect(canAccessPage(["technician"], "/tenant/brand-new-page")).toBe(false);
    expect(canAccessPage(["tenant_admin"], "/tenant/brand-new-page")).toBe(true);
    expect(canAccessPage(["technician"], "/tenant/routers/")).toBe(true);
    expect(canAccessPage(["technician"], "/tenant/routersx")).toBe(false);
  });
  it("end users get nothing", () => expect(open(["end_user"])).toEqual([]));
  it("revenue is limited to admin and billing", () => {
    expect(hasAnyRole(["technician"], REVENUE_ROLES)).toBe(false);
    expect(hasAnyRole(["billing_agent"], REVENUE_ROLES)).toBe(true);
  });
});
