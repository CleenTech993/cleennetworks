import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  ClipboardList,
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
import { useAuth } from "@/hooks/use-auth";

const ALL_NAV: NavItem[] = [
  { to: "/tenant", label: "Overview", icon: LayoutDashboard },
  { to: "/tenant/noc", label: "NOC Monitor", icon: Radar, group: "Network" },
  { to: "/tenant/routers", label: "Routers", icon: Router, group: "Network" },
  { to: "/tenant/recovery", label: "Outage Recovery", icon: Power, group: "Network" },
  {
    to: "/tenant/tools",
    label: "Diagnostics & Tools",
    icon: Wrench,
    group: "Network",
  },
  { to: "/tenant/hotspot", label: "Hotspot", icon: Wifi, group: "Services" },
  { to: "/tenant/devices", label: "Devices", icon: Smartphone, group: "Services" },
  { to: "/tenant/pppoe", label: "PPPoE", icon: Network, group: "Services" },
  { to: "/tenant/static-ips", label: "Static IPs", icon: Globe, group: "Services" },
  { to: "/tenant/portal", label: "Captive Portal", icon: Palette, group: "Services" },
  { to: "/tenant/packages", label: "Packages", icon: Package, group: "Services" },
  { to: "/tenant/customers", label: "Customers", icon: Users, group: "Customers & Field" },
  { to: "/tenant/sessions", label: "Sessions", icon: Activity, group: "Customers & Field" },
  {
    to: "/tenant/work-orders",
    label: "Work orders",
    icon: ClipboardList,
    group: "Customers & Field",
  },
  { to: "/tenant/inventory", label: "Inventory", icon: Boxes, group: "Customers & Field" },
  { to: "/tenant/tickets", label: "Support", icon: LifeBuoy, group: "Customers & Field" },
  {
    to: "/tenant/customer-billing",
    label: "Customer billing",
    icon: ReceiptText,
    group: "Billing",
  },
  { to: "/tenant/payments", label: "Payments", icon: CreditCard, group: "Billing" },
  { to: "/tenant/billing", label: "Platform invoices", icon: ReceiptText, group: "Billing" },
  { to: "/tenant/sms", label: "Notifications", icon: MessageSquare, group: "Communications" },
  {
    to: "/tenant/communications",
    label: "Communications",
    icon: Megaphone,
    group: "Communications",
  },
  { to: "/tenant/team", label: "Team", icon: UserCog, group: "Administration" },
  { to: "/tenant/audit", label: "Audit Log", icon: History, group: "Administration" },
  {
    to: "/tenant/migration",
    label: "Backup & Migration",
    icon: Archive,
    group: "Administration",
  },
  { to: "/tenant/settings", label: "Settings", icon: Settings, group: "Administration" },
];

export const Route = createFileRoute("/tenant")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  // Session lives in browser storage; server render can't see it (that caused logout on refresh).
  ssr: false,
  beforeLoad: async ({ location }) => {
    let roles = await requireConsole();
    const hostname = window.location.hostname.toLowerCase();
    const canonicalHost = (import.meta.env.VITE_APP_CANONICAL_HOST ?? "").trim().toLowerCase();
    if (!hostname.endsWith(".workers.dev") && (!canonicalHost || hostname !== canonicalHost)) {
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
  const isDemoViewer = roles.includes("demo_viewer");
  const { tenantId } = useAuth();
  const { data: isDemo } = useQuery({
    queryKey: ["tenant-demo-workspace", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("is_demo")
        .eq("id", tenantId!)
        .single();
      if (error) throw error;
      return data.is_demo;
    },
  });
  const { labels } = useTenantLabels();
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
      readOnly={isDemoViewer}
      headerAction={<TenantWhatsAppSupport />}
    >
      {isDemo && (
        <div
          role="status"
          className="mb-5 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <p className="font-semibold">
            {isDemoViewer ? "Read-only demo workspace" : "Demo workspace"}
          </p>
          <p className="mt-1">
            {isDemoViewer
              ? "Explore the sample records and workflows. This shared demo cannot be changed; no live router, customer, or payment integration is connected."
              : "These are fictional sample records. Changes stay in your workspace; no live router, customer, or payment integration is set up."}
          </p>
        </div>
      )}
      <Outlet />
    </DashboardShell>
  );
}
