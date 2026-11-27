export type PlannerCustomerCount = {
  activeCustomerCount: number;
  existingNodeCount: number;
};

export type ExpansionScenario = {
  projectedCustomers: number;
  plannedNodes: number;
  capacityPerNode: number;
  projectedUtilizationPercent: number;
  remainingCapacity: number;
  recommendation: "adequate" | "watch" | "expand";
};

export function planNetworkExpansion(
  { activeCustomerCount, existingNodeCount }: PlannerCustomerCount,
  addedCustomers: number,
  addedNodes: number,
  capacityPerNode = 100,
): ExpansionScenario {
  const normalizedAddedCustomers = Math.max(
    0,
    Math.trunc(Number.isFinite(addedCustomers) ? addedCustomers : 0),
  );
  const normalizedAddedNodes = Math.max(
    0,
    Math.trunc(Number.isFinite(addedNodes) ? addedNodes : 0),
  );
  const normalizedExistingNodes = Math.max(0, Math.trunc(existingNodeCount));
  const normalizedActiveCustomers = Math.max(0, Math.trunc(activeCustomerCount));
  const normalizedCapacity = Math.max(1, Math.trunc(capacityPerNode));
  const projectedCustomers = normalizedActiveCustomers + normalizedAddedCustomers;
  const plannedNodes = normalizedExistingNodes + normalizedAddedNodes;
  const totalCapacity = plannedNodes * normalizedCapacity;
  const projectedUtilizationPercent =
    totalCapacity > 0
      ? Math.round((projectedCustomers / totalCapacity) * 100)
      : projectedCustomers > 0
        ? 100
        : 0;
  const remainingCapacity = Math.max(totalCapacity - projectedCustomers, 0);

  const recommendation =
    projectedUtilizationPercent >= 90
      ? "expand"
      : projectedUtilizationPercent >= 70
        ? "watch"
        : "adequate";

  return {
    projectedCustomers,
    plannedNodes,
    capacityPerNode: normalizedCapacity,
    projectedUtilizationPercent,
    remainingCapacity,
    recommendation,
  };
}
