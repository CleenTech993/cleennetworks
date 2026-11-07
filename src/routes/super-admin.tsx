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
  History,
  Megaphone,
} from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/dashboard-shell";
import { requireConsole } from "@/lib/auth-guard";

const nav: NavItem[] = [
  { to: "/super-admin", label: "Overview", icon: LayoutDashboard },
  { to: "/super-admin/noc", label: "NOC", icon: Radar },
  { to: "/super-admin/tenants", label: "Tenants", icon: Building2 },
  { to: "/super-admin/payments", label: "Platform C2B", icon: Wallet },
  { to: "/super-admin/communications", label: "Communications", icon: Megaphone },
  { to: "/super-admin/settlements", label: "Commissions", icon: Banknote },
  { to: "/super-admin/billing", label: "SaaS Billing", icon: CreditCard },
  { to: "/super-admin/health", label: "Platform Health", icon: Activity },
  { to: "/super-admin/users", label: "Users", icon: Users },
  { to: "/super-admin/audit", label: "Audit Logs", icon: History },
];

export const Route = createFileRoute("/super-admin")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  ssr: false,
  beforeLoad: () => requireConsole({ superAdmin: true }),
  component: () => (
    <DashboardShell title="Super Admin" subtitle="Platform control" nav={nav}>
      <Outlet />
    </DashboardShell>
  ),
});
