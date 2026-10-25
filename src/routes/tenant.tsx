import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
  LayoutDashboard, Router, Wifi, Network, Palette, Package, Users,
  Activity, Boxes, CreditCard, MessageSquare, LifeBuoy, Settings, UserCog,
} from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/dashboard-shell";
import { requireConsole } from "@/lib/auth-guard";
import { canAccessPage } from "@/lib/permissions";

const ALL_NAV: NavItem[] = [
  { to: "/tenant", label: "Overview", icon: LayoutDashboard },
  { to: "/tenant/routers", label: "Routers", icon: Router },
  { to: "/tenant/hotspot", label: "Hotspot", icon: Wifi },
  { to: "/tenant/pppoe", label: "PPPoE", icon: Network },
  { to: "/tenant/portal", label: "Captive Portal", icon: Palette },
  { to: "/tenant/packages", label: "Packages", icon: Package },
  { to: "/tenant/customers", label: "Customers", icon: Users },
  { to: "/tenant/sessions", label: "Sessions", icon: Activity },
  { to: "/tenant/inventory", label: "Inventory", icon: Boxes },
  { to: "/tenant/payments", label: "Payments", icon: CreditCard },
  { to: "/tenant/sms", label: "Notifications", icon: MessageSquare },
  { to: "/tenant/tickets", label: "Support", icon: LifeBuoy },
  { to: "/tenant/team", label: "Team", icon: UserCog },
  { to: "/tenant/settings", label: "Settings", icon: Settings },
];

export const Route = createFileRoute("/tenant")({
  // Session lives in browser storage; server render can't see it (that caused logout on refresh).
  ssr: false,
  beforeLoad: async ({ location }) => {
    const roles = await requireConsole();
    // Block pages this role can't use even when typed into the address bar.
    if (!canAccessPage(roles, location.pathname)) throw redirect({ to: "/tenant" });
    return { roles };
  },
  component: TenantLayout,
});

function TenantLayout() {
  const { roles } = Route.useRouteContext();
  const nav = ALL_NAV.filter((item) => canAccessPage(roles, item.to));
  return (
    <DashboardShell title="Tenant Console" subtitle="ISP operations" nav={nav}>
      <Outlet />
    </DashboardShell>
  );
}
