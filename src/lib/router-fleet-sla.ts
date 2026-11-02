export interface FleetSlaRouter {
  id: string;
  name: string;
  created_at: string;
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
}

export interface FleetSlaOutage {
  router_id: string;
  started_at: string;
  ended_at: string | null;
}

export interface FleetSlaResult {
  routerId: string;
  routerName: string;
  uptimePercent: number | null;
  outageCount: number;
  periodStart: string | null;
  periodEnd: string;
}

const STALE_HEARTBEAT_MS = 3 * 60_000;

function mergedDownTime(
  outages: FleetSlaOutage[],
  startMs: number,
  endMs: number,
  staleSinceMs: number | null,
): number {
  const intervals = outages.flatMap((outage) => {
    const outageStart = new Date(outage.started_at).getTime();
    const outageEnd = outage.ended_at ? new Date(outage.ended_at).getTime() : endMs;
    if (!Number.isFinite(outageStart) || !Number.isFinite(outageEnd)) return [];
    const clippedStart = Math.max(startMs, outageStart);
    const clippedEnd = Math.min(endMs, outageEnd);
    return clippedEnd > clippedStart ? [[clippedStart, clippedEnd] as const] : [];
  });

  if (staleSinceMs != null && staleSinceMs < endMs) {
    const clippedStart = Math.max(startMs, staleSinceMs);
    if (endMs > clippedStart) intervals.push([clippedStart, endMs]);
  }

  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let intervalStart: number | null = null;
  let intervalEnd = 0;
  for (const [currentStart, currentEnd] of intervals) {
    if (intervalStart == null) {
      intervalStart = currentStart;
      intervalEnd = currentEnd;
    } else if (currentStart <= intervalEnd) {
      intervalEnd = Math.max(intervalEnd, currentEnd);
    } else {
      total += intervalEnd - intervalStart;
      intervalStart = currentStart;
      intervalEnd = currentEnd;
    }
  }
  if (intervalStart != null) total += intervalEnd - intervalStart;
  return total;
}

export function calculateFleetSla({
  routers,
  outages,
  windowMs,
  now = Date.now(),
}: {
  routers: FleetSlaRouter[];
  outages: FleetSlaOutage[];
  windowMs: number;
  now?: number;
}): FleetSlaResult[] {
  const byRouter = new Map<string, FleetSlaOutage[]>();
  for (const outage of outages) {
    const rows = byRouter.get(outage.router_id) ?? [];
    rows.push(outage);
    byRouter.set(outage.router_id, rows);
  }

  return routers.map((router) => {
    const firstSeen = new Date(router.created_at).getTime();
    const rangeStart = Math.max(now - windowMs, firstSeen);
    const total = now - rangeStart;
    const heartbeat = router.last_heartbeat_at ?? router.last_seen_at;
    const heartbeatAt = heartbeat ? new Date(heartbeat).getTime() : Number.NaN;
    const events = byRouter.get(router.id) ?? [];
    const relevantEvents = events.filter((event) => {
      const eventStart = new Date(event.started_at).getTime();
      const eventEnd = event.ended_at ? new Date(event.ended_at).getTime() : now;
      return (
        Number.isFinite(eventStart) &&
        Number.isFinite(eventEnd) &&
        eventEnd > rangeStart &&
        eventStart < now
      );
    });

    if (
      !Number.isFinite(firstSeen) ||
      !Number.isFinite(heartbeatAt) ||
      total <= 0 ||
      rangeStart >= now
    ) {
      return {
        routerId: router.id,
        routerName: router.name,
        uptimePercent: null,
        outageCount: relevantEvents.length,
        periodStart: null,
        periodEnd: new Date(now).toISOString(),
      };
    }

    const hasOpenOutage = relevantEvents.some((event) => event.ended_at == null);
    const staleSince =
      !hasOpenOutage && now - heartbeatAt > STALE_HEARTBEAT_MS
        ? heartbeatAt + STALE_HEARTBEAT_MS
        : null;
    const down = mergedDownTime(relevantEvents, rangeStart, now, staleSince);

    return {
      routerId: router.id,
      routerName: router.name,
      uptimePercent: Math.max(0, Math.min(100, ((total - down) / total) * 100)),
      outageCount: relevantEvents.length,
      periodStart: new Date(rangeStart).toISOString(),
      periodEnd: new Date(now).toISOString(),
    };
  });
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safeText = /^[\t\r=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export function buildFleetSlaCsv(results: FleetSlaResult[], range: string, generatedAt: string) {
  const rows = [
    ["Generated at", generatedAt],
    ["Reporting period", range],
    [],
    ["Router", "Uptime", "SLA target", "SLA result", "Outage events", "Period start", "Period end"],
    ...results.map((result) => [
      result.routerName,
      result.uptimePercent == null ? "Unavailable" : `${result.uptimePercent.toFixed(2)}%`,
      "99.50%",
      result.uptimePercent == null
        ? "Unavailable"
        : result.uptimePercent >= 99.5
          ? "Met"
          : "Below target",
      result.outageCount,
      result.periodStart ?? "Unavailable",
      result.periodEnd,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
