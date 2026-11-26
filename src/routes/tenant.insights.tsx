import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AlertTriangle, Lightbulb, Plus, Trash2, TrendingUp } from "lucide-react";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  buildMonthlyPerformance,
  findChurnRisks,
  forecastNext90Days,
  formatAnalyticsAmount,
  formatAnalyticsMonth,
  recommendDataPackages,
  type AnalyticsCustomer,
  type AnalyticsPackage,
  type OperatingCost,
  type RevenueMonth,
} from "@/lib/isp-analytics";
import { logAudit } from "@/lib/audit";

export const Route = createFileRoute("/tenant/insights")({ component: TenantInsights });

const PAGE_SIZE = 1000;

function currentMonthInput(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function loadActiveCustomers(tenantId: string): Promise<AnalyticsCustomer[]> {
  const customers: AnalyticsCustomer[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("customers")
      .select("id,full_name,status,last_seen_at,expires_at,package_id,data_used_bytes")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    customers.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return customers;
  }
}

async function loadOperatingCosts(tenantId: string): Promise<OperatingCost[]> {
  const costs: OperatingCost[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("tenant_operating_costs")
      .select("id,amount,category,effective_month,recurring_monthly,ends_after_month,description")
      .eq("tenant_id", tenantId)
      .order("effective_month", { ascending: false })
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    costs.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return costs;
  }
}

async function loadPackages(tenantId: string): Promise<AnalyticsPackage[]> {
  const packages: AnalyticsPackage[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("packages")
      .select("id,name,kind,price,data_limit_mb,unlimited,active")
      .eq("tenant_id", tenantId)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    packages.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return packages;
  }
}

async function loadFailedPaymentCounts(
  tenantId: string,
  since: string,
): Promise<Map<string, number>> {
  const failures = new Map<string, number>();

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc("tenant_failed_payment_counts", { p_tenant_id: tenantId, p_since: since })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      failures.set(row.customer_id, row.unsuccessful_payment_count);
    }
    if (!data || data.length < PAGE_SIZE) return failures;
  }
}

function TenantInsights() {
  const { tenantId, user } = useAuth();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [effectiveMonth, setEffectiveMonth] = useState(currentMonthInput);
  const [recurring, setRecurring] = useState(false);
  const [endsAfterMonth, setEndsAfterMonth] = useState("");

  const insightsQuery = useQuery({
    queryKey: ["tenant-business-insights", tenantId],
    enabled: !!tenantId,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [revenueResult, costs, customers, packages, failedPayments] = await Promise.all([
        supabase.rpc("tenant_revenue_by_month", {
          p_tenant_id: tenantId!,
          p_months: 12,
        }),
        loadOperatingCosts(tenantId!),
        loadActiveCustomers(tenantId!),
        loadPackages(tenantId!),
        loadFailedPaymentCounts(tenantId!, since),
      ]);

      if (revenueResult.error) throw revenueResult.error;

      return {
        revenue: (revenueResult.data ?? []) as RevenueMonth[],
        costs,
        customers,
        packages,
        failedPayments,
      };
    },
  });

  const addCost = useMutation({
    mutationFn: async (input: {
      category: string;
      amount: number;
      effective_month: string;
      recurring_monthly: boolean;
      ends_after_month: string | null;
      description: string | null;
    }) => {
      const { data, error } = await supabase
        .from("tenant_operating_costs")
        .insert({
          ...input,
          tenant_id: tenantId!,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { ...input, id: data.id };
    },
    onSuccess: async (cost) => {
      await logAudit({
        tenantId,
        action: "create",
        resource: "operating_cost",
        resourceId: cost.id,
        description: `Added ${cost.category} operating cost`,
        details: {
          amount: cost.amount,
          effective_month: cost.effective_month,
          recurring_monthly: cost.recurring_monthly,
        },
      });
      toast.success("Operating cost added");
      setCategory("");
      setAmount("");
      setEndsAfterMonth("");
      void queryClient.invalidateQueries({ queryKey: ["tenant-business-insights", tenantId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeCost = useMutation({
    mutationFn: async (cost: OperatingCost) => {
      const { data, error } = await supabase
        .from("tenant_operating_costs")
        .delete()
        .eq("id", cost.id)
        .eq("tenant_id", tenantId!)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("The operating cost could not be found or removed.");
      return cost;
    },
    onSuccess: async (cost) => {
      await logAudit({
        tenantId,
        action: "delete",
        resource: "operating_cost",
        resourceId: cost.id,
        description: `Removed ${cost.category} operating cost`,
        details: { amount: cost.amount, effective_month: cost.effective_month },
      });
      toast.success("Operating cost removed");
      void queryClient.invalidateQueries({ queryKey: ["tenant-business-insights", tenantId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const performance = useMemo(
    () =>
      buildMonthlyPerformance(insightsQuery.data?.revenue ?? [], insightsQuery.data?.costs ?? []),
    [insightsQuery.data],
  );
  const latest = performance[performance.length - 1];
  const currentForecast = useMemo(
    () => forecastNext90Days(insightsQuery.data?.revenue ?? []),
    [insightsQuery.data?.revenue],
  );
  const churnRisks = useMemo(
    () =>
      findChurnRisks(
        insightsQuery.data?.customers ?? [],
        insightsQuery.data?.failedPayments ?? new Map(),
      ).slice(0, 8),
    [insightsQuery.data],
  );
  const packageRecommendations = useMemo(
    () =>
      recommendDataPackages(
        insightsQuery.data?.customers ?? [],
        insightsQuery.data?.packages ?? [],
      ).slice(0, 8),
    [insightsQuery.data],
  );

  function submitCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCategory = category.trim();
    const parsedAmount = Number(amount);
    const normalizedMonth = `${effectiveMonth}-01`;
    const normalizedEndMonth = endsAfterMonth ? `${endsAfterMonth}-01` : null;

    if (!trimmedCategory || trimmedCategory.length > 80) {
      toast.error("Enter a cost category of 1 to 80 characters.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    if (recurring && normalizedEndMonth && normalizedEndMonth < normalizedMonth) {
      toast.error("The recurring cost end month must be on or after its start month.");
      return;
    }
    if (!recurring && normalizedEndMonth) {
      toast.error("Only recurring costs can have an end month.");
      return;
    }

    addCost.mutate({
      category: trimmedCategory,
      amount: parsedAmount,
      effective_month: normalizedMonth,
      recurring_monthly: recurring,
      ends_after_month: recurring ? normalizedEndMonth : null,
      description: null,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business insights"
        description="Tenant-wide profitability, revenue outlook, customer retention signals, and package fit."
      />

      {insightsQuery.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading business insights…
        </p>
      ) : insightsQuery.isError ? (
        <section className="rounded-xl border border-destructive/30 bg-card p-4" role="alert">
          <p className="font-medium">Business insights are temporarily unavailable.</p>
          <p className="mt-1 text-sm text-muted-foreground">{insightsQuery.error.message}</p>
          <Button className="mt-3" variant="outline" onClick={() => void insightsQuery.refetch()}>
            Try again
          </Button>
        </section>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Collected this month"
              value={formatAnalyticsAmount(latest?.revenue ?? 0)}
              hint="Successful payments only"
            />
            <StatCard
              label="Recorded costs this month"
              value={formatAnalyticsAmount(latest?.costs ?? 0)}
              hint="Recurring and one-off entries"
            />
            <StatCard
              label="Net so far this month"
              value={formatAnalyticsAmount(latest?.net ?? 0)}
              hint="Collections less recorded costs"
            />
            <StatCard
              label="Next 90-day revenue outlook"
              value={
                currentForecast === null ? "Not available" : formatAnalyticsAmount(currentForecast)
              }
              hint="Previous 3 complete months × 3; not a guarantee"
            />
          </div>

          <section className="rounded-xl border bg-card">
            <div className="border-b p-4">
              <h2 className="font-semibold">Revenue and operating costs</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Recorded payment amounts and costs use the same currency units. Net is an estimate,
                not an accounting statement.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Month</th>
                    <th className="px-4 py-3 text-right">Successful payments</th>
                    <th className="px-4 py-3 text-right">Collected</th>
                    <th className="px-4 py-3 text-right">Recorded costs</th>
                    <th className="px-4 py-3 text-right">Net estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {performance
                    .slice()
                    .reverse()
                    .map((row) => (
                      <tr key={row.month} className="border-t">
                        <td className="px-4 py-3 font-medium">{formatAnalyticsMonth(row.month)}</td>
                        <td className="px-4 py-3 text-right">{row.successfulPayments}</td>
                        <td className="px-4 py-3 text-right">
                          {formatAnalyticsAmount(row.revenue)}
                        </td>
                        <td className="px-4 py-3 text-right">{formatAnalyticsAmount(row.costs)}</td>
                        <td
                          className={`px-4 py-3 text-right font-medium ${row.net < 0 ? "text-destructive" : ""}`}
                        >
                          {formatAnalyticsAmount(row.net)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border bg-card">
            <div className="border-b p-4">
              <h2 className="font-semibold">Operating costs</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add costs in the same currency units as your payment records. Recurring entries are
                counted monthly from their start month until their optional end month.
              </p>
            </div>
            <form
              onSubmit={submitCost}
              className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-6"
            >
              <Input
                aria-label="Cost category"
                placeholder="Category (e.g. upstream bandwidth)"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                maxLength={80}
                required
              />
              <Input
                aria-label="Cost amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
              <Input
                aria-label="Effective month"
                type="month"
                value={effectiveMonth}
                onChange={(event) => setEffectiveMonth(event.target.value)}
                required
              />
              <label className="flex items-center gap-2 rounded-lg border px-3 text-sm">
                <input
                  type="checkbox"
                  checked={recurring}
                  onChange={(event) => {
                    setRecurring(event.target.checked);
                    if (!event.target.checked) setEndsAfterMonth("");
                  }}
                />
                Recurring monthly
              </label>
              <Input
                aria-label="Recurring cost end month"
                type="month"
                value={endsAfterMonth}
                onChange={(event) => setEndsAfterMonth(event.target.value)}
                disabled={!recurring}
              />
              <Button type="submit" disabled={addCost.isPending}>
                <Plus />
                {addCost.isPending ? "Adding…" : "Add cost"}
              </Button>
            </form>
            <div className="divide-y">
              {(insightsQuery.data?.costs ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No operating costs recorded yet.
                </p>
              ) : (
                insightsQuery.data?.costs.map((cost) => (
                  <div
                    key={cost.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-4"
                  >
                    <div>
                      <p className="font-medium">{cost.category}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatAnalyticsMonth(cost.effective_month)}
                        {cost.recurring_monthly ? " · recurring monthly" : " · one-off"}
                        {cost.ends_after_month
                          ? ` through ${formatAnalyticsMonth(cost.ends_after_month)}`
                          : ""}
                        {cost.description ? ` · ${cost.description}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">
                        {formatAnalyticsAmount(Number(cost.amount))}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${cost.category} cost`}
                        disabled={removeCost.isPending}
                        onClick={() => {
                          if (window.confirm(`Remove the ${cost.category} operating cost?`)) {
                            removeCost.mutate(cost);
                          }
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-xl border bg-card">
              <div className="flex items-start gap-3 border-b p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                <div>
                  <h2 className="font-semibold">Retention signals</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Active customers with recent inactivity, expiry, or unsuccessful payment
                    signals.
                  </p>
                </div>
              </div>
              {churnRisks.length ? (
                <div className="divide-y">
                  {churnRisks.map((risk) => (
                    <div
                      key={risk.customerId}
                      className="flex flex-wrap items-start justify-between gap-3 p-4"
                    >
                      <div>
                        <p className="font-medium">{risk.customerName}</p>
                        <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
                          {risk.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                      <Badge variant={risk.level === "high" ? "destructive" : "secondary"}>
                        {risk.level} · {risk.score}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  No customers currently match these signals.
                </p>
              )}
            </section>

            <section className="rounded-xl border bg-card">
              <div className="flex items-start gap-3 border-b p-4">
                <Lightbulb className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <h2 className="font-semibold">Package fit opportunities</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Customers near a measured plan data limit, matched to a higher-data package of
                    the same service type and no lower price.
                  </p>
                </div>
              </div>
              {packageRecommendations.length ? (
                <div className="divide-y">
                  {packageRecommendations.map((recommendation) => (
                    <div key={recommendation.customerId} className="p-4">
                      <p className="font-medium">{recommendation.customerName}</p>
                      <p className="mt-1 text-sm">
                        {recommendation.currentPackage} → {recommendation.suggestedPackage}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{recommendation.reason}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex gap-2 p-4 text-sm text-muted-foreground">
                  <TrendingUp className="h-4 w-4 shrink-0" />
                  <p>No data-limit package upgrade signals are available right now.</p>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
