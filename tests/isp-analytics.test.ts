import { describe, expect, it } from "vitest";
import {
  buildMonthlyPerformance,
  findChurnRisks,
  forecastNext90Days,
  recommendDataPackages,
  type AnalyticsCustomer,
  type AnalyticsPackage,
} from "../src/lib/isp-analytics";

const now = new Date("2026-11-15T12:00:00.000Z");

describe("ISP analytics", () => {
  it("calculates monthly net performance with recurring and one-off costs", () => {
    const rows = buildMonthlyPerformance(
      [
        { month: "2026-10-01", revenue: 1000, successful_payment_count: 10 },
        { month: "2026-11-01", revenue: 600, successful_payment_count: 6 },
      ],
      [
        {
          id: "rent",
          amount: 200,
          category: "Rent",
          effective_month: "2026-10-01",
          recurring_monthly: true,
          ends_after_month: null,
        },
        {
          id: "repair",
          amount: 100,
          category: "Repair",
          effective_month: "2026-10-01",
          recurring_monthly: false,
          ends_after_month: null,
        },
      ],
      now,
      2,
    );

    expect(rows).toEqual([
      {
        month: "2026-10",
        revenue: 1000,
        costs: 300,
        net: 700,
        successfulPayments: 10,
      },
      {
        month: "2026-11",
        revenue: 600,
        costs: 200,
        net: 400,
        successfulPayments: 6,
      },
    ]);
  });

  it("forecasts 90 days from the last three complete months, excluding the partial current month", () => {
    expect(
      forecastNext90Days(
        [
          { month: "2026-08-01", revenue: 100, successful_payment_count: 1 },
          { month: "2026-09-01", revenue: 200, successful_payment_count: 2 },
          { month: "2026-10-01", revenue: 300, successful_payment_count: 3 },
          { month: "2026-11-01", revenue: 999, successful_payment_count: 9 },
        ],
        now,
      ),
    ).toBe(600);
    expect(forecastNext90Days([], now)).toBeNull();
    expect(
      forecastNext90Days([{ month: "2026-11-01", revenue: 999, successful_payment_count: 9 }], now),
    ).toBeNull();
  });

  it("explains churn signals and ignores inactive customers", () => {
    const customers: AnalyticsCustomer[] = [
      {
        id: "risk",
        full_name: "Customer A",
        status: "active",
        last_seen_at: "2026-10-01T00:00:00.000Z",
        expires_at: "2026-11-20T00:00:00.000Z",
        package_id: null,
        data_used_bytes: 0,
      },
      {
        id: "inactive",
        full_name: "Customer B",
        status: "inactive",
        last_seen_at: "2026-10-01T00:00:00.000Z",
        expires_at: null,
        package_id: null,
        data_used_bytes: 0,
      },
    ];

    const risks = findChurnRisks(customers, new Map([["risk", 1]]), now);
    expect(risks).toHaveLength(1);
    expect(risks[0]).toMatchObject({
      customerId: "risk",
      score: 100,
      level: "high",
    });
    expect(risks[0]?.reasons).toHaveLength(3);
  });

  it("suggests the lowest-priced higher-data package only after 80% of the current allowance", () => {
    const customer: AnalyticsCustomer = {
      id: "customer",
      full_name: "Customer A",
      status: "active",
      last_seen_at: null,
      expires_at: null,
      package_id: "small",
      data_used_bytes: 90 * 1024 * 1024,
    };
    const packages: AnalyticsPackage[] = [
      {
        id: "small",
        name: "10 GB",
        kind: "pppoe",
        price: 500,
        data_limit_mb: 100,
        unlimited: false,
        active: true,
      },
      {
        id: "medium",
        name: "20 GB",
        kind: "pppoe",
        price: 700,
        data_limit_mb: 200,
        unlimited: false,
        active: true,
      },
      {
        id: "large",
        name: "50 GB",
        kind: "pppoe",
        price: 900,
        data_limit_mb: 500,
        unlimited: false,
        active: true,
      },
    ];

    expect(recommendDataPackages([customer], packages)[0]).toMatchObject({
      suggestedPackage: "20 GB",
      usagePercent: 90,
    });
    expect(
      recommendDataPackages([{ ...customer, data_used_bytes: 79 * 1024 * 1024 }], packages),
    ).toHaveLength(0);
  });
});
