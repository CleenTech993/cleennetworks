import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Check,
  CreditCard,
  Package,
  Router,
  Users,
  Radar,
  Network,
  Wifi,
  Wrench,
  TrendingUp,
  ArrowUpRight,
  ShieldAlert,
  Building2,
  Mail,
  UserRound,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { hasAnyRole, REVENUE_ROLES } from "@/lib/permissions";
import { isRouterLive } from "@/lib/router-health";
import { countOnlineClients } from "@/lib/online-clients";
import { CONNECTED_WINDOW_MS } from "@/lib/pppoe-sessions";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/tenant/")({ component: Overview });

function Overview() {
  const { roles } = Route.useRouteContext();
  const { user, profile, tenantId } = useAuth();
  const showRevenue = hasAnyRole(roles, REVENUE_ROLES);
  const isAdmin = hasAnyRole(roles, ["tenant_admin"]);
  const canSeeHotspotDevices = hasAnyRole(roles, ["tenant_admin", "technician", "support_staff"]);

  const { data: tenant } = useQuery({
    queryKey: ["tenant-dashboard-account", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", tenantId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data } = useQuery({
    queryKey: ["tenant-overview", showRevenue, canSeeHotspotDevices],
    queryFn: async () => {
      const countNow = Date.now();
      const devicesQuery = canSeeHotspotDevices
        ? supabase
            .from("router_devices")
            .select("mac,router_id,authorized,blocked,last_seen_at")
            .eq("authorized", true)
            .eq("blocked", false)
            .gte("last_seen_at", new Date(countNow - CONNECTED_WINDOW_MS).toISOString())
        : Promise.resolve({ data: [], error: null });
      const [routers, customers, packages, devices, payments] = await Promise.all([
        supabase.from("routers").select("id,status,last_heartbeat_at,last_seen_at"),
        supabase
          .from("customers")
          .select("id,status,customer_type,last_seen_at,expires_at,router_id,last_router_id"),
        supabase.from("packages").select("id", { count: "exact", head: true }),
        devicesQuery,
        showRevenue
          ? supabase
              .from("payments")
              .select("amount,status,created_at")
              .eq("status", "success")
              .order("created_at", { ascending: true })
          : Promise.resolve({ data: [] as { amount: number | string; created_at: string }[] }),
      ]);

      if (routers.error) throw routers.error;
      if (customers.error) throw customers.error;
      if (devices.error) throw devices.error;

      const allPayments = payments.data ?? [];
      const revenue = allPayments.reduce((s, p) => s + Number(p.amount), 0);
      const online = (routers.data ?? []).filter(isRouterLive).length;
      const allCust = customers.data ?? [];
      const clientCounts = countOnlineClients({
        routers: routers.data ?? [],
        customers: allCust,
        hotspotDevices: devices.data ?? [],
        now: countNow,
      });
      const activeCustomers = allCust.filter((c) => c.status === "active").length;
      const pppoeCount = allCust.filter((c) => c.customer_type === "pppoe").length;
      const hotspotCustCount = allCust.filter((c) => c.customer_type === "hotspot").length;

      // Group payments by date for the last 7 days chart
      const now = new Date();
      const last7Days: { date: string; amount: number; count: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const dayStr = d.toISOString().slice(0, 10);
        const dayLabel = d.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        const dayPayments = allPayments.filter((p) => p.created_at?.startsWith(dayStr));
        const dayTotal = dayPayments.reduce((s, p) => s + Number(p.amount), 0);
        last7Days.push({ date: dayLabel, amount: dayTotal, count: dayPayments.length });
      }

      const recentRevenue7d = last7Days.reduce((s, d) => s + d.amount, 0);

      return {
        routerCount: routers.data?.length ?? 0,
        online,
        customers: allCust.length,
        activeCustomers,
        pppoeCount,
        hotspotCustCount,
        onlineHotspot: canSeeHotspotDevices ? clientCounts.onlineHotspot : null,
        onlinePppoe: clientCounts.onlinePppoe,
        packages: packages.count ?? 0,
        revenue,
        recentRevenue7d,
        chartData: last7Days,
      };
    },
    refetchInterval: 10_000,
  });

  const steps = useMemo(
    () => [
      {
        done: (data?.routerCount ?? 0) > 0,
        title: "Add your first router",
        body: "Generate the setup line and paste it into the MikroTik terminal.",
        to: "/tenant/routers",
        cta: "Add router",
      },
      {
        done: (data?.packages ?? 0) > 0,
        title: "Create a package",
        body: "Set the price and duration customers can buy.",
        to: "/tenant/packages",
        cta: "Create package",
      },
      {
        done: false,
        title: "Add your M-Pesa details",
        body: "Enter your paybill or till so customers can pay you.",
        to: "/tenant/settings",
        cta: "Open settings",
      },
    ],
    [data],
  );

  const remaining = steps.filter((s) => !s.done).length;
  const metadataName =
    typeof user?.user_metadata["full_name"] === "string"
      ? user.user_metadata["full_name"]
      : typeof user?.user_metadata["name"] === "string"
        ? user.user_metadata["name"]
        : "";
  const accountName =
    profile?.full_name?.trim() || metadataName.trim() || user?.email?.split("@")[0];
  const firstName = accountName?.split(/\s+/)[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-7">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">{greeting}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              Welcome, {firstName}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Here’s your network overview{tenant?.name ? ` for ${tenant.name}` : ""}.
            </p>
          </div>
          <div className="grid gap-3 rounded-xl border bg-background/80 p-4 sm:min-w-72">
            <div className="flex items-center gap-2.5 text-sm">
              <UserRound className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate font-medium">{accountName || "Your account"}</span>
            </div>
            {user?.email && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0" />
                <span className="truncate">{user.email}</span>
              </div>
            )}
            {tenant?.name && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Building2 className="h-4 w-4 shrink-0" />
                <span className="truncate">{tenant.name}</span>
              </div>
            )}
          </div>
        </div>
      </section>
      <PageHeader
        title="ISP Operations Overview"
        description="Real-time telemetry, network health, subscriber distribution, and financial performance."
      />

      {/* Quick Launchpad for ISP Admins */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Link
          to="/tenant/noc"
          className="rounded-xl border bg-card p-4 hover:border-primary/50 hover:bg-muted/30 transition-all flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Radar className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-sm">NOC Monitor</p>
              <p className="text-xs text-muted-foreground">Topology & Health</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>

        <Link
          to="/tenant/pppoe"
          className="rounded-xl border bg-card p-4 hover:border-primary/50 hover:bg-muted/30 transition-all flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-sm">PPPoE Clients</p>
              <p className="text-xs text-muted-foreground">{data?.pppoeCount ?? 0} Subscriptions</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>

        <Link
          to="/tenant/hotspot"
          className="rounded-xl border bg-card p-4 hover:border-primary/50 hover:bg-muted/30 transition-all flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors">
              <Wifi className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-sm">Hotspot Vouchers</p>
              <p className="text-xs text-muted-foreground">Print & QR Codes</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>

        <Link
          to="/tenant/tools"
          className="rounded-xl border bg-card p-4 hover:border-primary/50 hover:bg-muted/30 transition-all flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-sm">Diagnostics</p>
              <p className="text-xs text-muted-foreground">Subnet & Ping Tools</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>
      </div>

      {/* Top Telemetry KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          icon={Router}
          label="Routers Fleet"
          value={data?.routerCount ?? "—"}
          hint={`${data?.online ?? 0} online · ${(data?.routerCount ?? 0) - (data?.online ?? 0)} offline`}
        />
        <StatCard
          icon={Users}
          label="Active Subscribers"
          value={data?.activeCustomers ?? "—"}
          hint={`${data?.customers ?? 0} total accounts registered`}
        />
        <StatCard
          icon={Wifi}
          label="Hotspot Clients Online"
          value={data?.onlineHotspot ?? "—"}
          hint="Recent authorized devices · live routers"
        />
        <StatCard
          icon={Network}
          label="PPPoE Clients Online"
          value={data?.onlinePppoe ?? "—"}
          hint="Recent sessions · live routers"
        />
        {showRevenue && (
          <StatCard
            icon={CreditCard}
            label="Total Revenue"
            value={data ? `KES ${data.revenue.toLocaleString()}` : "—"}
            hint={`KES ${(data?.recentRevenue7d ?? 0).toLocaleString()} in last 7 days`}
          />
        )}
      </div>

      {/* Revenue Intelligence & Subscriber Analytics */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* 7-Day Revenue Trend Chart */}
        {showRevenue && (
          <div className="rounded-xl border bg-card p-6 shadow-xs lg:col-span-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
              <div>
                <h3 className="font-semibold text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  7-Day Revenue Trend (KES)
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Daily incoming payments across Hotspot vouchers and PPPoE renewals.
                </p>
              </div>
              <Badge
                variant="outline"
                className="w-fit text-xs border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
              >
                KES {(data?.recentRevenue7d ?? 0).toLocaleString()} past 7d
              </Badge>
            </div>

            <div className="h-64 w-full">
              {data?.chartData && data.chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.chartData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(val: unknown) => [
                        `KES ${Number(val ?? 0).toLocaleString()}`,
                        "Revenue",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="amount"
                      stroke="#10b981"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#revGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                  No payment data recorded in the last 7 days.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Subscriber & Package Breakdown */}
        <div
          className={`rounded-xl border bg-card p-6 shadow-xs ${showRevenue ? "" : "lg:col-span-3"}`}
        >
          <h3 className="font-semibold text-base mb-1">Subscriber Segments</h3>
          <p className="text-xs text-muted-foreground mb-6">
            Distribution across PPPoE fixed clients and Hotspot vouchers.
          </p>

          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium flex items-center gap-2">
                  <Network className="h-4 w-4 text-emerald-500" />
                  PPPoE Clients
                </span>
                <span className="font-bold">{data?.pppoeCount ?? 0}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Fixed home & business broadband subscribers.
              </p>
            </div>

            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-amber-500" />
                  Hotspot Users
                </span>
                <span className="font-bold">{data?.hotspotCustCount ?? 0}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Voucher & wireless portal customers.
              </p>
            </div>

            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  Published Packages
                </span>
                <span className="font-bold">{data?.packages ?? 0}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Active speed tiers and duration plans.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding Wizard when items are incomplete */}
      {isAdmin && data && remaining > 0 && (
        <section className="rounded-xl border bg-card">
          <div className="border-b px-5 py-4">
            <h3 className="text-base font-semibold">Get your ISP running</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Your captive portal and automated billing go live once these core steps are completed.
            </p>
          </div>
          <ul className="divide-y">
            {steps.map((s) => (
              <li key={s.title} className="flex items-center gap-4 px-5 py-4">
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${s.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-input text-transparent"}`}
                  aria-label={s.done ? "Done" : "Not done"}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium ${s.done ? "text-muted-foreground line-through" : ""}`}
                  >
                    {s.title}
                  </p>
                  <p className="text-sm text-muted-foreground">{s.body}</p>
                </div>
                {!s.done && (
                  <Link
                    to={s.to}
                    className="shrink-0 text-sm font-medium text-primary hover:underline"
                  >
                    {s.cta}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
