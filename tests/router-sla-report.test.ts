import { describe, expect, it } from "vitest";
import { buildRouterSlaReportCsv } from "../src/lib/router-sla-report";

describe("buildRouterSlaReportCsv", () => {
  const base = {
    routerId: "router-1",
    range: "7d",
    generatedAt: "2026-11-02T10:00:00.000Z",
    periodStart: "2026-10-26T10:00:00.000Z",
    periodEnd: "2026-11-02T10:00:00.000Z",
    uptimePercent: 99.25,
    slaTarget: 99.5,
  };

  it("includes the reporting window, uptime result, and outage durations", () => {
    const report = buildRouterSlaReportCsv({
      ...base,
      outages: [
        {
          started_at: "2026-10-30T10:00:00.000Z",
          ended_at: "2026-10-30T10:10:00.000Z",
        },
        {
          started_at: "2026-10-20T10:00:00.000Z",
          ended_at: "2026-10-20T10:10:00.000Z",
        },
      ],
    });

    expect(report).toContain('"Router ID","router-1"');
    expect(report).toContain('"Reporting period","7d"');
    expect(report).toContain('"Uptime","99.25%"');
    expect(report).toContain('"SLA result","Below target"');
    expect(report).toContain('"2026-10-30T10:00:00.000Z","2026-10-30T10:10:00.000Z","10"');
    expect(report).not.toContain("2026-10-20");
  });

  it("reports unavailable uptime without claiming an SLA result", () => {
    const report = buildRouterSlaReportCsv({
      ...base,
      uptimePercent: null,
      outages: [],
    });

    expect(report).toContain('"Uptime","Unavailable"');
    expect(report).toContain('"SLA result","Unavailable"');
  });

  it("escapes quotes in exported values", () => {
    const report = buildRouterSlaReportCsv({
      ...base,
      routerId: 'router,"north"',
      outages: [],
    });

    expect(report).toContain('"Router ID","router,""north"""');
  });
});
