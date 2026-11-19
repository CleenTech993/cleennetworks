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
  { to: "/super-admin/noc", label: "NOC", icon: Radar, group: "Platform" },
  { to: "/super-admin/tenants", label: "Tenants", icon: Building2, group: "Platform" },
  { to: "/super-admin/payments", label: "Platform C2B", icon: Wallet, group: "Platform" },
  { to: "/super-admin/settlements", label: "Commissions", icon: Banknote, group: "Platform" },
  { to: "/super-admin/billing", label: "SaaS Billing", icon: CreditCard, group: "Platform" },
  { to: "/super-admin/health", label: "Platform Health", icon: Activity, group: "Platform" },
  {
    to: "/super-admin/communications",
    label: "Communications",
    icon: Megaphone,
    group: "Administration",
  },
  { to: "/super-admin/users", label: "Users", icon: Users, group: "Administration" },
  { to: "/super-admin/audit", label: "Audit Logs", icon: History, group: "Administration" },
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
