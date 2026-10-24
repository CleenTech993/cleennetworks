import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  LayoutDashboard, Router, Wifi, Network, Palette, Package, Users,
  Activity, CreditCard, MessageSquare, LifeBuoy, Settings, UserCog,
} from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/dashboard-shell";
import { requireConsole } from "@/lib/auth-guard";

const nav: NavItem[] = [
  { to: "/tenant", label: "Overview", icon: LayoutDashboard },
  { to: "/tenant/routers", label: "Routers", icon: Router },
  { to: "/tenant/hotspot", label: "Hotspot", icon: Wifi },
  { to: "/tenant/pppoe", label: "PPPoE", icon: Network },
  { to: "/tenant/portal", label: "Captive Portal", icon: Palette },
  { to: "/tenant/packages", label: "Packages", icon: Package },
  { to: "/tenant/customers", label: "Customers", icon: Users },
  { to: "/tenant/sessions", label: "Sessions", icon: Activity },
  { to: "/tenant/payments", label: "Payments", icon: CreditCard },
  { to: "/tenant/sms", label: "Notifications", icon: MessageSquare },
  { to: "/tenant/tickets", label: "Support", icon: LifeBuoy },
  { to: "/tenant/team", label: "Team", icon: UserCog },
  { to: "/tenant/settings", label: "Settings", icon: Settings },
];

export const Route = createFileRoute("/tenant")({
  // Session lives in browser storage; server render can't see it (that caused logout on refresh).
  ssr: false,
  beforeLoad: () => requireConsole(),
  component: TenantLayout,
});

function TenantLayout() {
  return (
    <DashboardShell title="Tenant Console" subtitle="ISP operations" nav={nav}>
      <Outlet />
    </DashboardShell>
  );
}
