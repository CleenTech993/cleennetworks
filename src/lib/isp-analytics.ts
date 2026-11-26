const DAY_MS = 24 * 60 * 60 * 1000;

export type RevenueMonth = {
  month: string;
  revenue: number;
  successful_payment_count: number;
};

export type OperatingCost = {
  id: string;
  amount: number;
  category: string;
  effective_month: string;
  recurring_monthly: boolean;
  ends_after_month: string | null;
  description?: string | null;
};

export type MonthlyPerformance = {
  month: string;
  revenue: number;
  costs: number;
  net: number;
  successfulPayments: number;
};

export type AnalyticsCustomer = {
  id: string;
  full_name: string | null;
  status: string;
  last_seen_at: string | null;
  expires_at: string | null;
  package_id: string | null;
  data_used_bytes: number;
};

export type AnalyticsPackage = {
  id: string;
  name: string;
  kind: string;
  price: number;
  data_limit_mb: number | null;
  unlimited: boolean | null;
  active: boolean | null;
};

export type ChurnRisk = {
  customerId: string;
  customerName: string;
  score: number;
  level: "high" | "medium";
  reasons: string[];
};

export type PackageRecommendation = {
  customerId: string;
  customerName: string;
  currentPackage: string;
  suggestedPackage: string;
  usagePercent: number;
  reason: string;
};

function monthKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthOffset(reference: Date, offset: number): string {
  const date = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + offset, 1));
  return monthKey(date);
}

function costApplies(cost: OperatingCost, month: string): boolean {
  const start = monthKey(cost.effective_month);
  if (!cost.recurring_monthly) return month === start;
  const end = cost.ends_after_month ? monthKey(cost.ends_after_month) : null;
  return month >= start && (!end || month <= end);
}

export function buildMonthlyPerformance(
  revenueRows: readonly RevenueMonth[],
  costs: readonly OperatingCost[],
  now = new Date(),
  monthCount = 6,
): MonthlyPerformance[] {
  const revenueByMonth = new Map(
    revenueRows.map((row) => [
      monthKey(row.month),
      {
        revenue: Number(row.revenue) || 0,
        count: Number(row.successful_payment_count) || 0,
      },
    ]),
  );
  const firstOffset = 1 - monthCount;

  return Array.from({ length: monthCount }, (_, index) => {
    const month = monthOffset(now, firstOffset + index);
    const revenue = revenueByMonth.get(month);
    const monthlyCosts = costs
      .filter((cost) => costApplies(cost, month))
      .reduce((sum, cost) => sum + Number(cost.amount || 0), 0);

    return {
      month,
      revenue: revenue?.revenue ?? 0,
      costs: monthlyCosts,
      net: (revenue?.revenue ?? 0) - monthlyCosts,
      successfulPayments: revenue?.count ?? 0,
    };
  });
}

export function forecastNext90Days(
  revenueRows: readonly RevenueMonth[],
  now = new Date(),
): number | null {
  if (revenueRows.length === 0) return null;
  const revenueByMonth = new Map(
    revenueRows.map((row) => [monthKey(row.month), Number(row.revenue) || 0]),
  );
  const lastThreeCompleteMonths = [-3, -2, -1].map((offset) => monthOffset(now, offset));
  if (!lastThreeCompleteMonths.some((month) => revenueByMonth.has(month))) return null;
  return lastThreeCompleteMonths.reduce((sum, month) => sum + (revenueByMonth.get(month) ?? 0), 0);
}

export function findChurnRisks(
  customers: readonly AnalyticsCustomer[],
  failedPaymentsByCustomer: ReadonlyMap<string, number>,
  now = new Date(),
): ChurnRisk[] {
  const risks: ChurnRisk[] = [];

  for (const customer of customers) {
    if (customer.status !== "active") continue;
    let score = 0;
    const reasons: string[] = [];

    if (customer.last_seen_at) {
      const lastSeen = new Date(customer.last_seen_at).getTime();
      if (Number.isFinite(lastSeen)) {
        const inactiveDays = Math.floor((now.getTime() - lastSeen) / DAY_MS);
        if (inactiveDays >= 30) {
          score += 40;
          reasons.push(`No activity for ${inactiveDays} days`);
        } else if (inactiveDays >= 14) {
          score += 30;
          reasons.push(`No activity for ${inactiveDays} days`);
        }
      }
    }

    if (customer.expires_at) {
      const expiry = new Date(customer.expires_at).getTime();
      if (Number.isFinite(expiry)) {
        const daysUntilExpiry = Math.ceil((expiry - now.getTime()) / DAY_MS);
        if (daysUntilExpiry <= 7) {
          score += 35;
          reasons.push(
            daysUntilExpiry < 0
              ? "Service expiry is overdue"
              : daysUntilExpiry === 0
                ? "Service expires today"
                : `Service expires in ${daysUntilExpiry} days`,
          );
        }
      }
    }

    const failedPayments = failedPaymentsByCustomer.get(customer.id) ?? 0;
    if (failedPayments > 0) {
      score += 25;
      reasons.push(
        `${failedPayments} unsuccessful payment attempt${failedPayments === 1 ? "" : "s"} in 30 days`,
      );
    }

    if (score >= 30) {
      risks.push({
        customerId: customer.id,
        customerName: customer.full_name?.trim() || "Unnamed customer",
        score,
        level: score >= 60 ? "high" : "medium",
        reasons,
      });
    }
  }

  return risks.sort((a, b) => b.score - a.score || a.customerName.localeCompare(b.customerName));
}

export function recommendDataPackages(
  customers: readonly AnalyticsCustomer[],
  packages: readonly AnalyticsPackage[],
): PackageRecommendation[] {
  const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const recommendations: PackageRecommendation[] = [];

  for (const customer of customers) {
    if (customer.status !== "active" || !customer.package_id) continue;
    const current = packageById.get(customer.package_id);
    if (
      !current ||
      current.active === false ||
      current.unlimited ||
      !current.data_limit_mb ||
      current.data_limit_mb <= 0
    ) {
      continue;
    }

    const limitBytes = current.data_limit_mb * 1024 * 1024;
    const usagePercent = (Number(customer.data_used_bytes) / limitBytes) * 100;
    if (!Number.isFinite(usagePercent) || usagePercent < 80) continue;

    const suggested = packages
      .filter(
        (pkg) =>
          pkg.active !== false &&
          !pkg.unlimited &&
          pkg.kind === current.kind &&
          Number(pkg.data_limit_mb) > current.data_limit_mb! &&
          pkg.price >= current.price,
      )
      .sort((a, b) => a.price - b.price || Number(a.data_limit_mb) - Number(b.data_limit_mb))[0];
    if (!suggested) continue;

    recommendations.push({
      customerId: customer.id,
      customerName: customer.full_name?.trim() || "Unnamed customer",
      currentPackage: current.name,
      suggestedPackage: suggested.name,
      usagePercent: Math.round(usagePercent),
      reason: `Usage is ${Math.round(usagePercent)}% of the current plan's data allowance.`,
    });
  }

  return recommendations.sort((a, b) => b.usagePercent - a.usagePercent);
}

export function formatAnalyticsAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount);
}

export function formatAnalyticsMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}
