import { describe, expect, it } from "vitest";
import {
  diagnoseNetwork,
  networkDoctorDeterministicSummary,
  type NetworkDoctorRouter,
} from "../src/lib/network-diagnostics";

const now = new Date("2026-11-27T12:00:00.000Z");

function router(overrides: Partial<NetworkDoctorRouter>): NetworkDoctorRouter {
  return {
    id: "router-1",
    name: "Router",
    status: "online",
    last_heartbeat_at: "2026-11-27T11:59:30.000Z",
    last_seen_at: null,
    cpu_load: 20,
    cpu_usage: null,
    ram_usage: 30,
    total_memory_mb: null,
    free_memory_mb: null,
    temperature: 45,
    uptime_seconds: 3600,
    parent_router_id: null,
    ...overrides,
  };
}

describe("Network Doctor deterministic diagnostics", () => {
  it("reports offline routers and points to chain roots", () => {
    const findings = diagnoseNetwork(
      [
        router({ id: "root", last_heartbeat_at: null, last_seen_at: null }),
        router({
          id: "child",
          parent_router_id: "root",
          last_heartbeat_at: null,
          last_seen_at: null,
        }),
      ],
      now,
    );
    expect(findings.some((finding) => finding.category === "availability")).toBe(true);
    expect(findings[0]?.title).toContain("2 routers");
  });

  it("reports critical CPU, memory, and temperature risks independently", () => {
    const findings = diagnoseNetwork(
      [router({ cpu_load: 95, ram_usage: 92, temperature: 78 })],
      now,
    );
    expect(findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining(["capacity", "hardware"]),
    );
    expect(findings.filter((finding) => finding.severity === "critical")).toHaveLength(3);
  });

  it("returns a healthy finding when no immediate risk is detected", () => {
    const findings = diagnoseNetwork([router({})], now);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toContain("No immediate");
  });

  it("creates a concise deterministic summary", () => {
    const findings = diagnoseNetwork([router({ cpu_load: 95 })], now);
    expect(networkDoctorDeterministicSummary(findings)).toContain("critical");
  });
});
