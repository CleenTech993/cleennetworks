import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_LABELS,
  formatTenantDate,
  normalizeCustomDomain,
  sanitizeTenantLabels,
  sanitizeUserPreferences,
} from "../src/lib/tenant-customization";

describe("tenant customization", () => {
  it("uses safe defaults and trims tenant labels", () => {
    expect(sanitizeTenantLabels(null)).toEqual(DEFAULT_TENANT_LABELS);
    expect(sanitizeTenantLabels({ pppoe: "  Broadband  ", unknown: "ignored" })).toEqual({
      ...DEFAULT_TENANT_LABELS,
      pppoe: "Broadband",
    });
  });

  it("normalizes valid custom domains and rejects malformed hosts", () => {
    expect(normalizeCustomDomain(" WiFi.Example.COM. ")).toBe("wifi.example.com");
    for (const invalid of ["", "wifi", "a..example.com", "-wifi.example.com", "127.0.0.1"]) {
      expect(normalizeCustomDomain(invalid)).toBeNull();
    }
  });

  it("sanitizes personal preferences and uses the selected time zone", () => {
    const preferences = sanitizeUserPreferences({
      theme: "dark",
      dateFormat: "iso",
      timeZone: "UTC",
      dashboardLayout: "compact",
    });
    expect(preferences).toEqual({
      theme: "dark",
      dateFormat: "iso",
      timeZone: "UTC",
      dashboardLayout: "compact",
    });
    expect(
      formatTenantDate("2025-12-31T23:59:00Z", {
        preferences,
      }),
    ).toContain("2025-12-31");
    expect(sanitizeUserPreferences({ timeZone: "not/a-time-zone" }).timeZone).toBe("local");
  });
});
