import { describe, expect, it } from "vitest";
import { buildTvSyncLines, isRandomizedMac, isTvActive, normalizeMac } from "../src/lib/tv";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const FUTURE = "2026-10-25T12:00:00Z";
const PAST = "2026-10-23T12:00:00Z";

describe("normalizeMac", () => {
  it("accepts the common notations", () => {
    for (const m of [
      "aa:bb:cc:dd:ee:ff",
      "AA-BB-CC-DD-EE-FF",
      "aabb.ccdd.eeff",
      " AABBCCDDEEFF ",
    ]) {
      expect(normalizeMac(m)).toBe("AA:BB:CC:DD:EE:FF");
    }
  });
  it("rejects malformed, multicast and empty addresses", () => {
    for (const m of [
      "",
      "AA:BB:CC",
      "AA:BB:CC:DD:EE:GG",
      "01:00:5E:00:00:01",
      "FF:FF:FF:FF:FF:FF",
      "00:00:00:00:00:00",
    ]) {
      expect(normalizeMac(m)).toBeNull();
    }
  });
  it("rejects anything that could escape a RouterOS string", () => {
    expect(normalizeMac('AA:BB:CC:DD:EE:F"; /system reset-configuration')).toBeNull();
    expect(normalizeMac("AA:BB:CC:DD:EE:FF\n/ip hotspot")).toBeNull();
  });
});

describe("isRandomizedMac", () => {
  it("detects the locally-administered bit", () => {
    expect(isRandomizedMac("DA:A1:19:00:00:01")).toBe(true);
    expect(isRandomizedMac("AC:5A:14:00:00:01")).toBe(false);
  });
});

describe("isTvActive", () => {
  const base = { mac_address: "AA:BB:CC:DD:EE:FF", status: "active", expires_at: FUTURE };
  it("is true only for active, unexpired devices", () => {
    expect(isTvActive(base, NOW)).toBe(true);
    expect(isTvActive({ ...base, expires_at: PAST }, NOW)).toBe(false);
    expect(isTvActive({ ...base, expires_at: null }, NOW)).toBe(false);
    expect(isTvActive({ ...base, status: "pending" }, NOW)).toBe(false);
    expect(isTvActive({ ...base, status: "blocked" }, NOW)).toBe(false);
  });
});

describe("buildTvSyncLines", () => {
  it("lists only currently-allowed MACs, de-duplicated", () => {
    const out = buildTvSyncLines(
      [
        { mac_address: "AA:BB:CC:DD:EE:01", status: "active", expires_at: FUTURE },
        { mac_address: "AA:BB:CC:DD:EE:01", status: "active", expires_at: FUTURE },
        { mac_address: "AA:BB:CC:DD:EE:02", status: "active", expires_at: PAST },
        { mac_address: "AA:BB:CC:DD:EE:03", status: "blocked", expires_at: FUTURE },
      ],
      NOW,
    ).join("\n");
    expect(out).toContain(':toarray "AA:BB:CC:DD:EE:01"');
    expect(out).not.toContain("EE:02");
    expect(out).not.toContain("EE:03");
    expect(out).toContain("type=bypassed");
  });
  it("still emits the cleanup block when no TV is active, so expired TVs are cut off", () => {
    const out = buildTvSyncLines([], NOW).join("\n");
    expect(out).toContain(':toarray ""');
    expect(out).toContain("ip-binding remove");
    expect(out).toContain("ip hotspot active remove");
  });
  it("never emits an address that fails validation", () => {
    const out = buildTvSyncLines(
      [{ mac_address: 'AA"; :log error "x', status: "active", expires_at: FUTURE }],
      NOW,
    ).join("\n");
    expect(out).toContain(':toarray ""');
    expect(out).not.toContain(":log error");
  });
});
