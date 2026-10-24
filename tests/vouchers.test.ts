import { describe, expect, it } from "vitest";
import { expiryFrom } from "../src/lib/duration";
import { buildHotspotLoginRedirect, parseHotspotLoginUrl } from "../src/lib/hotspot-redirect";

describe("expiryFrom", () => {
  const t0 = Date.UTC(2026, 9, 24, 12, 0, 0);
  const hoursAhead = (value: number, unit: string) => (new Date(expiryFrom(value, unit, t0)).getTime() - t0) / 3_600_000;

  it("understands the plural units the package form saves", () => {
    expect(hoursAhead(30, "minutes")).toBe(0.5);
    expect(hoursAhead(1, "hours")).toBe(1);
    expect(hoursAhead(2, "days")).toBe(48);
    expect(hoursAhead(1, "weeks")).toBe(168);
    expect(hoursAhead(1, "months")).toBe(720);
  });

  it("still accepts singular units and is case/space tolerant", () => {
    expect(hoursAhead(1, "hour")).toBe(1);
    expect(hoursAhead(1, " Hours ")).toBe(1);
  });

  it("falls back to days for an unknown unit (previous behaviour)", () => {
    expect(hoursAhead(1, "fortnights")).toBe(24);
  });
});

describe("hotspot login redirect", () => {
  it("accepts the router's login URL by IP or hotspot DNS name", () => {
    expect(parseHotspotLoginUrl("http://10.5.50.1/login")).not.toBeNull();
    expect(parseHotspotLoginUrl("http://hotspot.netgrid/login")).not.toBeNull();
    expect(parseHotspotLoginUrl("http://192.168.88.1/login")).not.toBeNull();
    expect(parseHotspotLoginUrl("http://172.20.0.1/login")).not.toBeNull();
  });

  it("rejects anything that could send the voucher code off the local network", () => {
    for (const bad of [
      "http://evil.example/login",
      "https://10.5.50.1/login",
      "http://10.5.50.1@evil.example/login",
      "http://user:pw@10.5.50.1/login",
      "http://8.8.8.8/login",
      "http://172.32.0.1/login",
      "http://10.5.50.1/other",
      "javascript:alert(1)",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(parseHotspotLoginUrl(bad as string | null | undefined)).toBeNull();
    }
  });

  it("builds a login URL using the code as username and password", () => {
    const url = new URL(buildHotspotLoginRedirect("http://10.5.50.1/login?stale=1", "ABCD234567")!);
    expect(url.origin).toBe("http://10.5.50.1");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("username")).toBe("ABCD234567");
    expect(url.searchParams.get("password")).toBe("ABCD234567");
    expect(url.searchParams.has("stale")).toBe(false);
  });

  it("returns null when there is no safe login link", () => {
    expect(buildHotspotLoginRedirect("http://evil.example/login", "X")).toBeNull();
    expect(buildHotspotLoginRedirect(null, "X")).toBeNull();
  });
});
