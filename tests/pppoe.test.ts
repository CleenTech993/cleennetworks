import { describe, expect, it } from "vitest";
import {
  buildPppoeSyncLines,
  formatSpeed,
  pppoeProfileName,
  pppoeRateLimit,
  renewedExpiry,
  validatePppoeCredentials,
} from "../src/lib/pppoe";

const ROUTER = "r1";
const PKG = "3f9a1c2b-0000-4000-8000-000000000001";
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const future = new Date(NOW + 86_400_000).toISOString();
const past = new Date(NOW - 86_400_000).toISOString();

const client = (
  o: Partial<Parameters<typeof buildPppoeSyncLines>[0]["customers"][number]> = {},
) => ({
  pppoe_username: "john.home",
  pppoe_password: "secret12",
  expires_at: future,
  router_id: null,
  package_id: PKG,
  ...o,
});
const build = (
  customers: ReturnType<typeof client>[],
  dl: number | null = 5000,
  ul: number | null = 2000,
) =>
  buildPppoeSyncLines({
    routerId: ROUTER,
    customers,
    packages: [{ id: PKG, download_kbps: dl, upload_kbps: ul }],
    now: NOW,
  }).join("\n");

describe("credentials", () => {
  it("accepts safe usernames and passwords", () => {
    expect(validatePppoeCredentials("john.house12", "ab12-CD")).toBeNull();
  });
  it("rejects characters that could break a RouterOS string", () => {
    expect(validatePppoeCredentials('jo"hn', "abcd1234")).not.toBeNull();
    expect(validatePppoeCredentials("john", 'a"; /system reset')).not.toBeNull();
    expect(validatePppoeCredentials("ab", "abcd")).not.toBeNull();
  });
});

describe("speed + profile helpers", () => {
  it("builds the rate-limit from the router's point of view (upload/download)", () => {
    expect(pppoeRateLimit(5000, 2000)).toBe("2000k/5000k");
    expect(pppoeRateLimit(5000, null)).toBe("0/5000k");
    expect(pppoeRateLimit(null, null)).toBeNull();
    expect(pppoeRateLimit(0, 0)).toBeNull();
  });
  it("names profiles from the package id", () => {
    expect(pppoeProfileName(PKG)).toBe("ng-3f9a1c2b");
  });
  it("formats speeds", () => {
    expect(formatSpeed(5000)).toBe("5 Mbps");
    expect(formatSpeed(1500)).toBe("1.5 Mbps");
    expect(formatSpeed(512)).toBe("512 kbps");
    expect(formatSpeed(null)).toBe("Unlimited");
  });
});

describe("renewedExpiry", () => {
  it("extends from the current expiry while it is still running", () => {
    const out = new Date(renewedExpiry(future, 1, "days", NOW)).getTime();
    expect(out).toBe(NOW + 2 * 86_400_000);
  });
  it("counts from now once expired or when never set", () => {
    expect(new Date(renewedExpiry(past, 1, "days", NOW)).getTime()).toBe(NOW + 86_400_000);
    expect(new Date(renewedExpiry(null, 1, "days", NOW)).getTime()).toBe(NOW + 86_400_000);
  });
});

describe("buildPppoeSyncLines", () => {
  it("creates a rate-limited profile and assigns the client to it", () => {
    const out = build([client()]);
    expect(out).toContain('/ppp profile add name="ng-3f9a1c2b"');
    expect(out).toContain('rate-limit="2000k/5000k"');
    expect(out).toContain(
      'add name="john.home" password="secret12" service=pppoe profile=ng-3f9a1c2b comment="netgrid"',
    );
  });
  it("uses the default profile when the package has no speed limit or no package", () => {
    expect(build([client()], null, null)).toContain("profile=netgrid-pppoe comment");
    expect(build([client({ package_id: null })])).toContain("profile=netgrid-pppoe comment");
  });
  it("skips expired clients, other routers' clients and unsafe credentials", () => {
    const out = build([
      client({ pppoe_username: "expired1", expires_at: past }),
      client({ pppoe_username: "otherrouter", router_id: "r2" }),
      client({ pppoe_username: 'evil"name' }),
      client({ pppoe_username: "badpass", pppoe_password: 'x"; /system reset' }),
      client({ pppoe_username: "good1" }),
    ]);
    expect(out).toContain('name="good1"');
    for (const bad of ["expired1", "otherrouter", "evil", "badpass"])
      expect(out).not.toContain(bad);
  });
  it("keeps clients with no expiry", () => {
    expect(build([client({ expires_at: null })])).toContain('name="john.home"');
  });
  it("snapshots old secrets first and disconnects removed / re-profiled clients last", () => {
    const lines = buildPppoeSyncLines({ routerId: ROUTER, customers: [], packages: [], now: NOW });
    const out = lines.join("\n");
    expect(out.indexOf(":local ngOld")).toBeLessThan(
      out.indexOf('remove [find comment="netgrid"]'),
    );
    expect(out.indexOf('remove [find comment="netgrid"]')).toBeLessThan(
      out.indexOf("/ppp active remove"),
    );
  });
});
