import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Radar,
  Wrench,
  Router,
  Wifi,
  Network,
  Globe,
  Palette,
  Package,
  Users,
  Activity,
  Boxes,
  CreditCard,
  ReceiptText,
  MessageSquare,
  Megaphone,
  LifeBuoy,
  Settings,
  History,
  UserCog,
  Smartphone,
  Archive,
  Power,
} from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/dashboard-shell";
import { TenantWhatsAppSupport } from "@/components/tenant-whatsapp-support";
import { requireConsole } from "@/lib/auth-guard";
import { canAccessPage } from "@/lib/permissions";
import { useTenantLabels } from "@/hooks/use-tenant-customization";
import { supabase } from "@/integrations/supabase/client";

const ALL_NAV: NavItem[] = [
  { to: "/tenant", label: "Overview", icon: LayoutDashboard },
  { to: "/tenant/noc", label: "NOC Monitor", icon: Radar },
  { to: "/tenant/routers", label: "Routers", icon: Router },
  { to: "/tenant/recovery", label: "Outage Recovery", icon: Power },
  { to: "/tenant/hotspot", label: "Hotspot", icon: Wifi },
  { to: "/tenant/devices", label: "Devices", icon: Smartphone },
  { to: "/tenant/pppoe", label: "PPPoE", icon: Network },
  { to: "/tenant/static-ips", label: "Static IPs", icon: Globe },
  { to: "/tenant/portal", label: "Captive Portal", icon: Palette },
  { to: "/tenant/packages", label: "Packages", icon: Package },
  { to: "/tenant/customers", label: "Customers", icon: Users },
  { to: "/tenant/sessions", label: "Sessions", icon: Activity },
  { to: "/tenant/inventory", label: "Inventory", icon: Boxes },
  { to: "/tenant/payments", label: "Payments", icon: CreditCard },
  { to: "/tenant/billing", label: "Platform invoices", icon: ReceiptText },
  { to: "/tenant/sms", label: "Notifications", icon: MessageSquare },
  { to: "/tenant/communications", label: "Communications", icon: Megaphone },
  { to: "/tenant/tools", label: "Diagnostics & Tools", icon: Wrench },
  { to: "/tenant/tickets", label: "Support", icon: LifeBuoy },
  { to: "/tenant/team", label: "Team", icon: UserCog },
  { to: "/tenant/audit", label: "Audit Log", icon: History },
  { to: "/tenant/migration", label: "Backup & Migration", icon: Archive },
  { to: "/tenant/settings", label: "Settings", icon: Settings },
];

export const Route = createFileRoute("/tenant")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  // Session lives in browser storage; server render can't see it (that caused logout on refresh).
  ssr: false,
  beforeLoad: async ({ location }) => {
    let roles = await requireConsole();
    const hostname = window.location.hostname.toLowerCase();
    const canonicalHost = (import.meta.env.VITE_APP_CANONICAL_HOST ?? "").trim().toLowerCase();
    if (!canonicalHost || hostname !== canonicalHost) {
      const domainResponse = await fetch("/api/public/domain", { cache: "no-store" });
      if (domainResponse.ok) {
        const mapping = (await domainResponse.json()) as {
          purpose?: string;
          tenantId?: string;
        };
        if (mapping.purpose === "hotspot") throw redirect({ to: "/" });
        if (mapping.purpose === "console") {
          const {
            data: { user },
            error: userError,
          } = await supabase.auth.getUser();
          if (userError) throw userError;
          if (!user) throw redirect({ to: "/login" });
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("tenant_id")
            .eq("id", user.id)
            .maybeSingle();
          if (profileError) throw profileError;
          if (!mapping.tenantId || profile?.tenant_id !== mapping.tenantId) {
            throw new Error(
              "This account is not a member of the organization using this console domain.",
            );
          }
          const { data: tenantRoles, error: rolesError } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("tenant_id", mapping.tenantId);
          if (rolesError) throw rolesError;
          roles = (tenantRoles ?? []).map((row) => row.role);
          if (!roles.length) throw redirect({ to: "/pending" });
        }
      } else if (domainResponse.status !== 404) {
        throw new Error("Could not verify this console domain.");
      }
    }
    // Block pages this role can't use even when typed into the address bar.
    if (!canAccessPage(roles, location.pathname)) throw redirect({ to: "/tenant" });
    return { roles };
  },
  component: TenantLayout,
});

function TenantLayout() {
  const { roles } = Route.useRouteContext();
  const labels = useTenantLabels();
  const labelKeyByPath: Record<string, keyof typeof labels> = {
    "/tenant": "overview",
    "/tenant/noc": "noc",
    "/tenant/routers": "routers",
    "/tenant/hotspot": "hotspot",
    "/tenant/pppoe": "pppoe",
    "/tenant/packages": "packages",
    "/tenant/customers": "customers",
    "/tenant/payments": "payments",
  };
  const nav = ALL_NAV.filter((item) => canAccessPage(roles, item.to)).map((item) => ({
    ...item,
    label: labels[labelKeyByPath[item.to]] ?? item.label,
  }));
  return (
    <DashboardShell
      title="Tenant Console"
      subtitle="ISP operations"
      nav={nav}
      headerAction={<TenantWhatsAppSupport />}
    >
      <Outlet />
    </DashboardShell>
  );
}
