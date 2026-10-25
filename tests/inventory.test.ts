import { describe, expect, it } from "vitest";
import {
  buildDeviceMonitorLines, deviceHealth, parseDeviceReport, planReading, safeTargets, STALE_AFTER_MS,
} from "../src/lib/inventory-monitor";
import { describeError, formatQty, isLowStock, isValidIpv4, normalizeMac } from "../src/lib/inventory";

const A = "11111111-2222-3333-4444-555555555555";
const B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const URL = "https://app.example.com/api/public/router/devices/TOKEN";

describe("router monitor script", () => {
  it("emits a device list, reporter script, scheduler and netwatch sync", () => {
    const text = buildDeviceMonitorLines([{ id: A, ip_address: "10.0.0.5" }, { id: B, ip_address: "10.0.0.6" }], URL).join("\n");
    expect(text).toContain(`:global ngIds [:toarray "${A},${B}"]`);
    expect(text).toContain(':global ngIps [:toarray "10.0.0.5,10.0.0.6"]');
    expect(text).toContain(`:global ngReportUrl "${URL}"`);
    expect(text).toContain("/system script add name=netgrid-devices");
    expect(text).toContain("/system scheduler add name=netgrid-devices interval=1m");
    expect(text).toContain("/tool netwatch add host=($ngIps->$pos)");
    expect(text).toContain("/tool netwatch remove $n");
  });

  it("an empty list clears every NetGrid netwatch entry", () => {
    const text = buildDeviceMonitorLines([], URL).join("\n");
    expect(text).toContain(':global ngIds [:toarray ""]');
    expect(text).toContain(':global ngIps [:toarray ""]');
  });

  it("never lets unsafe values reach RouterOS code", () => {
    const targets = [
      { id: A, ip_address: '1.1.1.1"; /system reset-configuration' },
      { id: "not-a-uuid", ip_address: "10.0.0.7" },
      { id: B, ip_address: "10.0.0.300" },
      { id: B, ip_address: null },
      { id: A, ip_address: "10.0.0.8" },
    ];
    expect(safeTargets(targets)).toEqual([{ id: A, ip: "10.0.0.8" }]);
    const text = buildDeviceMonitorLines(targets, URL).join("\n");
    expect(text).not.toContain("reset-configuration");
    expect(text).not.toContain("not-a-uuid");
  });

  it("de-duplicates devices and caps the list", () => {
    expect(safeTargets([{ id: A, ip_address: "10.0.0.1" }, { id: A, ip_address: "10.0.0.2" }])).toHaveLength(1);
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, ip_address: "10.0.0.1" }));
    expect(safeTargets(many).length).toBe(150);
  });
});

describe("device report parsing", () => {
  it("parses up/down readings", () => {
    expect(parseDeviceReport(`${A}~1,${B}~0,`)).toEqual([{ id: A, up: true }, { id: B, up: false }]);
  });
  it("ignores junk, duplicates and empty input", () => {
    expect(parseDeviceReport(null)).toEqual([]);
    expect(parseDeviceReport("")).toEqual([]);
    expect(parseDeviceReport(`bad~1,${A}~7,${A}~1,${A}~0,x`)).toEqual([{ id: A, up: true }]);
  });
  it("lowercases ids so they match the database", () => {
    expect(parseDeviceReport(`${A.toUpperCase()}~1`)[0].id).toBe(A);
  });
});

describe("state changes", () => {
  const now = "2026-10-25T10:00:00.000Z";
  it("first reading up: no event", () => expect(planReading(null, true, now).event).toBeNull());
  it("first reading down: records an outage", () => expect(planReading(null, false, now).event).toBe("down"));
  it("up -> down and down -> up are recorded", () => {
    expect(planReading(true, false, now).event).toBe("down");
    expect(planReading(false, true, now).event).toBe("up");
  });
  it("steady state records nothing and keeps status_changed_at", () => {
    const p = planReading(true, true, now);
    expect(p.event).toBeNull();
    expect(p.patch).not.toHaveProperty("status_changed_at");
    expect(p.patch.last_seen_at).toBe(now);
  });
  it("down readings do not refresh last_seen_at", () => expect(planReading(true, false, now).patch).not.toHaveProperty("last_seen_at"));
});

describe("device health", () => {
  const base = { monitor_enabled: true, online: true, last_checked_at: new Date().toISOString() };
  it("reports up / down", () => {
    expect(deviceHealth(base)).toBe("up");
    expect(deviceHealth({ ...base, online: false })).toBe("down");
  });
  it("is unknown before the first reading and when the readings go stale", () => {
    expect(deviceHealth({ ...base, online: null, last_checked_at: null })).toBe("unknown");
    expect(deviceHealth({ ...base, last_checked_at: new Date(Date.now() - STALE_AFTER_MS - 1000).toISOString() })).toBe("unknown");
  });
  it("not monitored when switched off", () => expect(deviceHealth({ ...base, monitor_enabled: false })).toBe("not_monitored"));
});

describe("inventory helpers", () => {
  it("validates IPs", () => {
    expect(isValidIpv4("192.168.88.20")).toBe(true);
    for (const bad of ["192.168.88", "256.1.1.1", "a.b.c.d", "1.1.1.1/24", ""]) expect(isValidIpv4(bad)).toBe(false);
  });
  it("normalises MAC addresses", () => {
    for (const m of ["AA:BB:CC:DD:EE:FF", "aa-bb-cc-dd-ee-ff", "aabb.ccdd.eeff", "aabbccddeeff"]) expect(normalizeMac(m)).toBe("aa:bb:cc:dd:ee:ff");
    expect(normalizeMac("nope")).toBeNull();
    expect(normalizeMac("aa:bb:cc")).toBeNull();
  });
  it("flags low stock only when a reorder level is set", () => {
    expect(isLowStock({ quantity: 2, reorder_level: 5 })).toBe(true);
    expect(isLowStock({ quantity: 5, reorder_level: 5 })).toBe(true);
    expect(isLowStock({ quantity: 6, reorder_level: 5 })).toBe(false);
    expect(isLowStock({ quantity: 0, reorder_level: 0 })).toBe(false);
  });
  it("formats quantities", () => {
    expect(formatQty(1200, "m")).toBe("1,200 m");
    expect(formatQty("12", "pcs")).toBe("12");
  });
  it("explains common database errors", () => {
    expect(describeError({ code: "23505", message: "duplicate key" })).toMatch(/serial/i);
    expect(describeError({ code: "42501", message: "new row violates row-level security policy" })).toMatch(/permission/i);
    expect(describeError({ message: "Not enough stock: 3 in stock, 10 requested" })).toMatch(/Not enough stock/);
  });
});
