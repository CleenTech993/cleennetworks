export type PublicNetworkStatus = "operational" | "degraded" | "outage" | "unknown";

export function publicNetworkStatus(
  totalRouters: number,
  liveRouters: number,
): PublicNetworkStatus {
  if (!Number.isFinite(totalRouters) || !Number.isFinite(liveRouters)) return "unknown";
  if (totalRouters <= 0 || liveRouters < 0 || liveRouters > totalRouters) return "unknown";
  if (liveRouters === 0) return "outage";
  if (liveRouters === totalRouters) return "operational";
  return "degraded";
}
