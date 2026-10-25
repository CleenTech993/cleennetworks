import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  Activity,
  Users,
  Wallet,
  Banknote,
  Radar,
} from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/dashboard-shell";
import { requireConsole } from "@/lib/auth-guard";

const nav: NavItem[] = [
  { to: "/super-admin", label: "Overview", icon: LayoutDashboard },
  { to: "/super-admin/noc", label: "NOC", icon: Radar },
  { to: "/super-admin/tenants", label: "Tenants", icon: Building2 },
  { to: "/super-admin/payments", label: "Platform Payments", icon: Wallet },
  { to: "/super-admin/settlements", label: "Settlements", icon: Banknote },
  { to: "/super-admin/billing", label: "SaaS Billing", icon: CreditCard },
  { to: "/super-admin/health", label: "Platform Health", icon: Activity },
  { to: "/super-admin/users", label: "Users", icon: Users },
];

export const Route = createFileRoute("/super-admin")({
  ssr: false,
  beforeLoad: () => requireConsole({ superAdmin: true }),
  component: () => (
    <DashboardShell title="Super Admin" subtitle="Platform control" nav={nav}>
      <Outlet />
    </DashboardShell>
  ),
});
