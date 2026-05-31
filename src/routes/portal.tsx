import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { LayoutDashboard, Package, Receipt, Activity } from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";

const nav: NavItem[] = [
  { to: "/portal", label: "My account", icon: LayoutDashboard },
  { to: "/portal/packages", label: "Buy package", icon: Package },
  { to: "/portal/usage", label: "Usage", icon: Activity },
  { to: "/portal/invoices", label: "Invoices", icon: Receipt },
];

export const Route = createFileRoute("/portal")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
  },
  component: () => <DashboardShell title="My Internet" subtitle="Self-service" nav={nav}><Outlet /></DashboardShell>,
});
