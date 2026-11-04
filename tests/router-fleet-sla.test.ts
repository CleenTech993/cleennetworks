import { describe, expect, it } from "vitest";
import {
  buildFleetSlaCsv,
  calculateFleetSla,
  type FleetSlaOutage,
  type FleetSlaRouter,
} from "../src/lib/router-fleet-sla";

const NOW = Date.UTC(2026, 10, 2, 12);
const DAY = 24 * 60 * 60 * 1000;

const router = (overrides: Partial<FleetSlaRouter> = {}): FleetSlaRouter => ({
  id: "r1",
  name: "North tower",
  created_at: new Date(NOW - 10 * DAY).toISOString(),
  last_heartbeat_at: new Date(NOW - 60_000).toISOString(),
  last_seen_at: null,
  ...overrides,
});

const outage = (start: number, end: number | null, routerId = "r1"): FleetSlaOutage => ({
  router_id: routerId,
  started_at: new Date(start).toISOString(),
  ended_at: end == null ? null : new Date(end).toISOString(),
});

describe("calculateFleetSla", () => {
  it("merges overlapping outages so downtime is not double-counted", () => {
    const results = calculateFleetSla({
      routers: [router()],
      outages: [outage(NOW - 30 * 60_000, NOW - 10 * 60_000), outage(NOW - 20 * 60_000, NOW)],
      windowMs: DAY,
      now: NOW,
    });

    expect(results[0]?.outageCount).toBe(2);
    expect(results[0]?.uptimePercent).toBeCloseTo(((24 * 60 - 30) / (24 * 60)) * 100, 4);
  });

  it("uses heartbeat staleness as downtime when no open outage event exists", () => {
    const results = calculateFleetSla({
      routers: [router({ last_heartbeat_at: new Date(NOW - 10 * 60_000).toISOString() })],
      outages: [],
      windowMs: DAY,
      now: NOW,
    });

    expect(results[0]?.uptimePercent).toBeCloseTo(((24 * 60 - 7) / (24 * 60)) * 100, 4);
  });

  it("marks routers without heartbeat telemetry as unavailable", () => {
    const results = calculateFleetSla({
      routers: [router({ last_heartbeat_at: null, last_seen_at: null })],
      outages: [],
      windowMs: DAY,
      now: NOW,
    });

    expect(results[0]?.uptimePercent).toBeNull();
  });

  it("limits outage counts and uptime to the selected period", () => {
    const results = calculateFleetSla({
      routers: [router()],
      outages: [
        outage(NOW - 2 * DAY, NOW - 2 * DAY + 10 * 60_000),
        outage(NOW - 30 * 60_000, NOW - 20 * 60_000),
      ],
      windowMs: DAY,
      now: NOW,
    });

    expect(results[0]?.outageCount).toBe(1);
    expect(results[0]?.uptimePercent).toBeCloseTo(((24 * 60 - 10) / (24 * 60)) * 100, 4);
  });
});

describe("buildFleetSlaCsv", () => {
  it("exports SLA results and escapes router names", () => {
    const results = calculateFleetSla({
      routers: [router({ name: 'North, "tower"' })],
      outages: [],
      windowMs: DAY,
      now: NOW,
    });
    const csv = buildFleetSlaCsv(results, "24h", new Date(NOW).toISOString());

    expect(csv).toContain('"North, ""tower"""');
    expect(csv).toContain('"SLA target","SLA result"');
    expect(csv).toContain('"99.50%","Met"');
  });

  it("neutralizes spreadsheet formulas in router names", () => {
    const results = calculateFleetSla({
      routers: [router({ name: '=HYPERLINK("https://example.test")' })],
      outages: [],
      windowMs: DAY,
      now: NOW,
    });

    expect(buildFleetSlaCsv(results, "24h", new Date(NOW).toISOString())).toContain(
      `"'=HYPERLINK(""https://example.test"")"`,
    );
  });
});
