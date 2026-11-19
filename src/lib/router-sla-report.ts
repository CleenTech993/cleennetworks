export interface RouterOutage {
  started_at: string;
  ended_at: string | null;
}

function csvCell(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildRouterSlaReportCsv({
  routerId,
  range,
  generatedAt,
  periodStart,
  periodEnd,
  uptimePercent,
  slaTarget,
  outages,
}: {
  routerId: string;
  range: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  uptimePercent: number | null;
  slaTarget: number;
  outages: RouterOutage[];
}): string {
  const periodStartMs = new Date(periodStart).getTime();
  const periodEndMs = new Date(periodEnd).getTime();
  const summary = [
    ["Router ID", routerId],
    ["Reporting period", range],
    ["Generated at", generatedAt],
    ["Period start", periodStart],
    ["Period end", periodEnd],
    ["Uptime", uptimePercent == null ? "Unavailable" : `${uptimePercent.toFixed(2)}%`],
    ["SLA target", `${slaTarget.toFixed(2)}%`],
    [
      "SLA result",
      uptimePercent == null ? "Unavailable" : uptimePercent >= slaTarget ? "Met" : "Below target",
    ],
  ];
  const rows = [
    ...summary,
    [],
    ["Outage started", "Outage ended", "Duration minutes"],
    ...outages.flatMap((outage) => {
      const start = new Date(outage.started_at).getTime();
      const end = outage.ended_at ? new Date(outage.ended_at).getTime() : periodEndMs;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        !Number.isFinite(periodStartMs) ||
        !Number.isFinite(periodEndMs)
      ) {
        return [];
      }
      const clippedStart = Math.max(start, periodStartMs);
      const clippedEnd = Math.min(end, periodEndMs);
      if (clippedEnd <= clippedStart) return [];
      return [
        [
          new Date(clippedStart).toISOString(),
          new Date(clippedEnd).toISOString(),
          Math.round((clippedEnd - clippedStart) / 60_000),
        ],
      ];
    }),
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
