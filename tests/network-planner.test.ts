import { describe, expect, it } from "vitest";
import { planNetworkExpansion } from "../src/lib/network-planner";

describe("network expansion planner", () => {
  it("calculates utilization from current demand and planned nodes", () => {
    expect(
      planNetworkExpansion({ activeCustomerCount: 80, existingNodeCount: 2 }, 100, 1, 100),
    ).toEqual({
      projectedCustomers: 180,
      plannedNodes: 3,
      capacityPerNode: 100,
      projectedUtilizationPercent: 60,
      remainingCapacity: 120,
      recommendation: "adequate",
    });
  });

  it("warns near capacity and recommends expansion at 90 percent", () => {
    expect(
      planNetworkExpansion({ activeCustomerCount: 140, existingNodeCount: 2 }, 0, 0, 100)
        .recommendation,
    ).toBe("watch");
    expect(
      planNetworkExpansion({ activeCustomerCount: 180, existingNodeCount: 2 }, 0, 0, 100)
        .recommendation,
    ).toBe("expand");
  });

  it("normalizes invalid and negative scenario values", () => {
    expect(
      planNetworkExpansion({ activeCustomerCount: -20, existingNodeCount: -2 }, -10, -1, 0),
    ).toMatchObject({
      projectedCustomers: 0,
      plannedNodes: 0,
      projectedUtilizationPercent: 0,
      remainingCapacity: 0,
    });
  });
});
