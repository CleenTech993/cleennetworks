import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { LayoutDashboard, Building2, CreditCard, Activity, Users, Wallet, Banknote, Radar } from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";

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
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    if (!roles?.some((r) => r.role === "super_admin")) throw redirect({ to: "/tenant" });
  },
  component: () => <DashboardShell title="Super Admin" subtitle="Platform control" nav={nav}><Outlet /></DashboardShell>,
});
