import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CreditCard,
  Router as RouterIcon,
  Users,
  TrendingUp,
  Activity,
  Download,
  ShieldCheck,
  ShieldAlert,
  ArrowUpRight,
  Wifi,
  Sparkles,
  Server,
  Zap,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { isRouterLive } from "@/lib/router-health";
import { toast } from "sonner";

export const Route = createFileRoute("/super-admin/")({ component: Overview });

type Timeframe = "7d" | "14d" | "30d";

function Overview() {
  const [timeframe, setTimeframe] = useState<Timeframe>("14d");

  const { data, refetch, isFetching, isError, error } = useQuery({
    queryKey: ["super-overview", timeframe],
    queryFn: async () => {
      const [tenantsRes, routersRes, customersRes, paymentsRes, packagesRes, sessionsRes] =
        await Promise.all([
          supabase.from("tenants").select("id,name,slug,status,created_at"),
          supabase
            .from("routers")
            .select("id,name,status,tenant_id,last_heartbeat_at,cpu_load,cpu_usage"),
          supabase.from("customers").select("id,customer_type,status,router_id"),
          supabase
            .from("payments")
            .select("amount,status,created_at,tenant_id,package_id")
            .eq("status", "success")
            .order("created_at", { ascending: true }),
          supabase.from("packages").select("id,tenant_id,kind"),
          supabase.from("sessions").select("id,status").eq("status", "active"),
        ]);

      const failedRequest = [
        tenantsRes,
        routersRes,
        customersRes,
        paymentsRes,
        packagesRes,
        sessionsRes,
      ].find((result) => result.error);
      if (failedRequest?.error) throw failedRequest.error;

      const tenants = tenantsRes.data ?? [];
      const routers = routersRes.data ?? [];
      const customers = customersRes.data ?? [];
      const payments = paymentsRes.data ?? [];
      const packagesById = new Map((packagesRes.data ?? []).map((pkg) => [pkg.id, pkg]));
      const sessions = sessionsRes.data ?? [];

      const estimatedCommission = (payment: (typeof payments)[number]) => {
        const pkg = payment.package_id ? packagesById.get(payment.package_id) : undefined;
        if (!pkg || pkg.tenant_id !== payment.tenant_id) return 0;
        const rate =
          pkg.kind === "pppoe"
            ? 0.01
            : ["hotspot", "voucher", "hotspot_tv"].includes(pkg.kind)
              ? 0.02
              : 0;
        return Number(payment.amount) * rate;
      };

      const totalGMV = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const totalCommission = payments.reduce(
        (sum, payment) => sum + estimatedCommission(payment),
        0,
      );

      const onlineRouters = routers.filter(isRouterLive).length;
      const offlineRouters = routers.length - onlineRouters;
      const degradedRouters = routers.filter(
        (router) => isRouterLive(router) && (router.cpu_load ?? router.cpu_usage ?? 0) >= 75,
      ).length;
      const activeCustomers = customers.filter((c) => c.status === "active").length;
      const pppoeCount = customers.filter((c) => c.customer_type === "pppoe").length;
      const hotspotCustCount = customers.filter((c) => c.customer_type === "hotspot").length;

      // Group payments by tenant for leaderboard
      const tenantSpend = new Map<string, { gmv: number; commission: number; count: number }>();
      for (const p of payments) {
        const cur = tenantSpend.get(p.tenant_id) ?? { gmv: 0, commission: 0, count: 0 };
        cur.gmv += Number(p.amount);
        cur.commission += estimatedCommission(p);
        cur.count += 1;
        tenantSpend.set(p.tenant_id, cur);
      }

      // Router counts per tenant
      const tenantRouterCounts = new Map<string, number>();
      for (const r of routers) {
        tenantRouterCounts.set(r.tenant_id, (tenantRouterCounts.get(r.tenant_id) ?? 0) + 1);
      }

      const routersByTenant = new Map<string, (typeof routers)[number][]>();
      for (const router of routers) {
        const tenantRouters = routersByTenant.get(router.tenant_id) ?? [];
        tenantRouters.push(router);
        routersByTenant.set(router.tenant_id, tenantRouters);
      }
      const activePppoeByRouter = new Map<string, number>();
      for (const customer of customers) {
        if (
          customer.status === "active" &&
          customer.customer_type === "pppoe" &&
          customer.router_id
        ) {
          activePppoeByRouter.set(
            customer.router_id,
            (activePppoeByRouter.get(customer.router_id) ?? 0) + 1,
          );
        }
      }

      const networkWatchlist = tenants
        .flatMap((tenant) => {
          const tenantRouters = routersByTenant.get(tenant.id) ?? [];
          const offline = tenantRouters.filter((router) => !isRouterLive(router));
          const degraded = tenantRouters.filter(
            (router) => isRouterLive(router) && (router.cpu_load ?? router.cpu_usage ?? 0) >= 75,
          );
          if (!offline.length && !degraded.length) return [];
          const flaggedRouterIds = new Set([...offline, ...degraded].map((router) => router.id));
          const accountsOnFlaggedRouters = [...flaggedRouterIds].reduce(
            (total, routerId) => total + (activePppoeByRouter.get(routerId) ?? 0),
            0,
          );
          return [
            {
              id: tenant.id,
              name: tenant.name,
              slug: tenant.slug,
              offlineRouters: offline.length,
              degradedRouters: degraded.length,
              accountsOnFlaggedRouters,
            },
          ];
        })
        .sort(
          (a, b) =>
            b.accountsOnFlaggedRouters - a.accountsOnFlaggedRouters ||
            b.offlineRouters - a.offlineRouters ||
            b.degradedRouters - a.degradedRouters ||
            a.name.localeCompare(b.name),
        );

      const leaderboard = tenants
        .map((t) => {
          const stats = tenantSpend.get(t.id) ?? { gmv: 0, commission: 0, count: 0 };
          return {
            id: t.id,
            name: t.name,
            slug: t.slug,
            status: t.status,
            routersCount: tenantRouterCounts.get(t.id) ?? 0,
            gmv: stats.gmv,
            commission: stats.commission,
            txCount: stats.count,
          };
        })
        .sort((a, b) => b.gmv - a.gmv);

      // Compute timeframe chart
      const daysCount = timeframe === "7d" ? 7 : timeframe === "14d" ? 14 : 30;
      const days: { date: string; gmv: number; commission: number; transactions: number }[] = [];
      const now = new Date();

      for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayStr = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        days.push({ date: label, gmv: 0, commission: 0, transactions: 0 });

        const dayPayments = payments.filter((p) => p.created_at.slice(0, 10) === dayStr);
        const dayGmv = dayPayments.reduce((s, p) => s + Number(p.amount), 0);
        const dayComm = dayPayments.reduce((sum, payment) => sum + estimatedCommission(payment), 0);

        const currentEntry = days[days.length - 1];
        currentEntry.gmv = dayGmv;
        currentEntry.commission = Math.round(dayComm);
        currentEntry.transactions = dayPayments.length;
      }

      return {
        tenantsCount: tenants.length,
        activeTenants: tenants.filter((t) => t.status === "active").length,
        routersCount: routers.length,
        onlineRouters,
        offlineRouters,
        degradedRouters,
        customersCount: customers.length,
        activeCustomers,
        pppoeCount,
        hotspotCustCount,
        activeHotspotSessions: sessions.length,
        networkWatchlist,
        totalGMV,
        totalCommission,
        chartData: days,
        leaderboard,
        paymentsRaw: payments,
      };
    },
    refetchInterval: 60_000,
  });

  const exportRevenueCSV = () => {
    if (!data?.leaderboard) return;
    // Neutralize spreadsheet formula characters (=, +, -, @) at the start of a cell so a
    // tenant-controlled name cannot execute as a formula when the report is opened.
    const csvCell = (v: string) => {
      const escaped = v.replace(/"/g, '""');
      return /^[-=+@]/.test(escaped) ? `'${escaped}` : escaped;
    };
    const header =
      "Tenant,Slug,Status,Routers,Gross Turnover (KES),Estimated Platform Commission (KES),Transactions\n";
    const rows = data.leaderboard
      .map(
        (t) =>
          `"${csvCell(t.name)}","${csvCell(t.slug)}","${csvCell(t.status)}",${t.routersCount},${t.gmv},${Math.round(t.commission)},${t.txCount}`,
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `platform_revenue_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Consolidated revenue report downloaded");
  };

  const chartData = data?.chartData ?? [];

  if (isError) {
    return (
      <div>
        <PageHeader
          title="Super Admin Executive Overview"
          description="Platform operations and cross-tenant performance."
        />
        <div className="rounded-xl border border-destructive/30 bg-card p-5" role="alert">
          <p className="font-semibold">Platform overview could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
          <Button className="mt-3" variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Super Admin Executive Overview"
        description="Consolidated revenue analytics, router telemetry, and cross-tenant performance."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetch();
                toast.success("Telemetry refreshed");
              }}
              disabled={isFetching}
            >
              <Activity className="h-4 w-4 mr-1 text-muted-foreground" />
              {isFetching ? "Refreshing…" : "Sync"}
            </Button>
            <Button variant="outline" size="sm" onClick={exportRevenueCSV} disabled={!data}>
              <Download className="h-4 w-4 mr-1" />
              Export Report
            </Button>
          </div>
        }
      />

      {/* Top Level Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={CreditCard}
          label="Platform GMV (KES)"
          value={data ? data.totalGMV.toLocaleString() : "—"}
          hint="All-time gross subscriber spend"
        />
        <StatCard
          icon={TrendingUp}
          label="Estimated Platform Commission"
          value={data ? `KES ${Math.round(data.totalCommission).toLocaleString()}` : "—"}
          hint="2% hotspot / voucher / phone + TV, 1% PPPoE; unclassified payments excluded"
        />
        <StatCard
          icon={Building2}
          label="Active ISP Tenants"
          value={data ? `${data.activeTenants} / ${data.tenantsCount}` : "—"}
          hint={
            data
              ? `${Math.round((data.activeTenants / (data.tenantsCount || 1)) * 100)}% active rate`
              : undefined
          }
        />
        <StatCard
          icon={RouterIcon}
          label="Global Router Fleet"
          value={data ? `${data.onlineRouters} online` : "—"}
          hint={data ? `${data.offlineRouters} offline (${data.routersCount} total)` : undefined}
        />
      </div>

      <section className="rounded-xl border bg-card p-5 shadow-sm" aria-labelledby="impact-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="impact-title" className="text-lg font-semibold">
                Network experience watchlist
              </h2>
              <Badge variant="outline" className="border-primary/20 text-primary">
                <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
                Premium insights
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Offline or high-CPU gateways ranked by assigned active PPPoE accounts.
            </p>
          </div>
          <Link to="/super-admin/noc">
            <Button variant="outline" size="sm">
              Open global NOC <ArrowUpRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>
        {!data ? (
          <p className="mt-5 text-sm text-muted-foreground" role="status">
            Loading network impact…
          </p>
        ) : data.networkWatchlist.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-4">ISP tenant</th>
                  <th className="pb-2 px-4 text-right">Offline</th>
                  <th className="pb-2 px-4 text-right">High CPU</th>
                  <th className="pb-2 px-4 text-right">Assigned active PPPoE accounts</th>
                  <th className="pb-2 pl-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.networkWatchlist.slice(0, 5).map((tenant) => (
                  <tr key={tenant.id} className="border-t">
                    <td className="py-3 pr-4">
                      <p className="font-medium">{tenant.name}</p>
                      <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant={tenant.offlineRouters ? "destructive" : "secondary"}>
                        {tenant.offlineRouters}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant={tenant.degradedRouters ? "outline" : "secondary"}>
                        {tenant.degradedRouters}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {tenant.accountsOnFlaggedRouters}
                    </td>
                    <td className="py-3 pl-4 text-right">
                      <Link to="/super-admin/noc">
                        <Button variant="ghost" size="sm">
                          Investigate <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.networkWatchlist.length > 5 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing the 5 tenants with the highest estimated subscriber impact.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            No offline gateways reported by active tenant networks.
          </p>
        )}
      </section>

      {/* Revenue & Growth Analytics AreaChart */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                Cross-Tenant Financial Analytics
              </h2>
              <Badge
                variant="outline"
                className="text-xs bg-primary/10 text-primary border-primary/20"
              >
                <Sparkles className="h-3 w-3 mr-1" /> Enterprise Telemetry
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Gross payment volume compared with commission estimated at the fixed 2% / 1% service
              rates. Unclassified payments are excluded from commission.
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-muted p-1 rounded-lg">
            {(["7d", "14d", "30d"] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  timeframe === tf
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tf === "7d" ? "7 Days" : tf === "14d" ? "14 Days" : "30 Days"}
              </button>
            ))}
          </div>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gmvGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="commGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                textAnchor="middle"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                width={45}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="rounded-lg border bg-background/95 backdrop-blur-sm p-3 shadow-md text-xs space-y-1.5">
                      <div className="font-semibold text-foreground">{label}</div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="h-2 w-2 rounded-full bg-primary" />
                          Gross Turnover:
                        </span>
                        <span className="font-mono font-medium text-foreground">
                          KES {Number(payload[0]?.value || 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          Platform Commission:
                        </span>
                        <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                          KES {Number(payload[1]?.value || 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="gmv"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#gmvGrad)"
                name="Gross Turnover"
              />
              <Area
                type="monotone"
                dataKey="commission"
                stroke="#10b981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#commGrad)"
                name="Platform Commission"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Fleet Telemetry + Client Infrastructure Breakdown */}
      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              Router Infrastructure
            </h3>
            <Link
              to="/super-admin/noc"
              className="text-xs text-primary hover:underline flex items-center"
            >
              Open NOC <ArrowUpRight className="h-3 w-3 ml-0.5" />
            </Link>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Fleet Online Ratio</span>
                <span className="font-semibold">
                  {data?.routersCount
                    ? `${Math.round((data.onlineRouters / data.routersCount) * 100)}%`
                    : "0%"}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{
                    width: data?.routersCount
                      ? `${Math.round((data.onlineRouters / data.routersCount) * 100)}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <div className="text-xs text-muted-foreground">Online Gateways</div>
                <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {data?.onlineRouters ?? 0}
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <div className="text-xs text-muted-foreground">Offline / Dark</div>
                <div className="text-lg font-bold text-amber-600 dark:text-amber-400">
                  {data?.offlineRouters ?? 0}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Subscriber Footprint
            </h3>
            <span className="text-xs text-muted-foreground">{data?.customersCount ?? 0} total</span>
          </div>
          <div className="space-y-3">
            <div className="rounded-lg bg-muted/40 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Wifi className="h-3.5 w-3.5 text-primary" /> PPPoE Fixed Fiber Users
                </span>
                <span className="font-mono font-medium">{data?.pppoeCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-500" /> Hotspot Voucher Clients
                </span>
                <span className="font-mono font-medium">{data?.hotspotCustCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t">
                <span className="text-muted-foreground">Active Wireless Sessions</span>
                <Badge variant="secondary" className="font-mono text-xs">
                  {data?.activeHotspotSessions ?? 0} live
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Platform Controls
            </h3>
            {!data ? (
              <Badge variant="outline" className="text-xs">
                Checking fleet…
              </Badge>
            ) : data.offlineRouters ? (
              <Badge
                variant="outline"
                className="border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs"
              >
                <ShieldAlert className="mr-1 h-3 w-3" />
                {data.offlineRouters} offline
              </Badge>
            ) : data.degradedRouters ? (
              <Badge
                variant="outline"
                className="border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs"
              >
                <ShieldAlert className="mr-1 h-3 w-3" />
                {data.degradedRouters} high CPU
              </Badge>
            ) : (
              <Badge variant="outline" className="text-emerald-600 border-emerald-500/20 text-xs">
                <ShieldCheck className="mr-1 h-3 w-3" />
                Fleet online
              </Badge>
            )}
          </div>
          <div className="space-y-2">
            <Link
              to="/super-admin/tenants"
              className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-xs font-medium"
            >
              <span className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                Manage ISP Tenants & Quotas
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>
            <Link
              to="/super-admin/settlements"
              className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-xs font-medium"
            >
              <span className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                SaaS Settlements & Payouts
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>
            <Link
              to="/super-admin/health"
              className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-xs font-medium"
            >
              <span className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                Edge & Webhook Diagnostics
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>
          </div>
        </div>
      </div>

      {/* Tenant Performance Leaderboard */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold tracking-tight">ISP Tenant Performance Leaderboard</h3>
            <p className="text-xs text-muted-foreground">
              Ranked by total subscriber payment volume processed across the platform.
            </p>
          </div>
          <Link to="/super-admin/tenants">
            <Button variant="ghost" size="sm" className="text-xs h-8">
              View All Tenants <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Tenant ISP</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-center">Routers</th>
                <th className="px-4 py-3 text-right">Transactions</th>
                <th className="px-4 py-3 text-right">Gross GMV</th>
                <th className="px-4 py-3 text-right">Estimated Platform Fee</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.leaderboard ?? []).map((t, idx) => (
                <tr key={t.id} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                        {idx + 1}
                      </span>
                      <div>
                        <div className="font-medium">{t.name}</div>
                        <div className="text-xs font-mono text-muted-foreground">{t.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={t.status === "active" ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {t.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{t.routersCount}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{t.txCount}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium">
                    KES {t.gmv.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                      KES {Math.round(t.commission).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Hotspot 2% · PPPoE 1%</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to="/super-admin/tenants">
                      <Button variant="outline" size="sm" className="h-7 text-xs">
                        Configure
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
              {(!data?.leaderboard || data.leaderboard.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No active tenants found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
