import { describe, expect, it } from "vitest";
import { buildDoctorInstallLines, buildDoctorPaste, doctorLines, DOCTOR_VERSION, safeHost } from "../src/lib/router-doctor";

const strip = (s: string) => s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
const balanced = (s: string) => {
  const t = strip(s);
  return [["{", "}"], ["[", "]"], ["(", ")"]].every(([a, b]) => t.split(a).length === t.split(b).length);
};

describe("router doctor", () => {
  const text = buildDoctorPaste("portal.example.com");

  it("is well-formed RouterOS: balanced brackets and quotes, no escaped dollars", () => {
    expect(balanced(text)).toBe(true);
    expect(text.replace(/\\./g, "").split('"').length % 2).toBe(1);
    expect(strip(text)).not.toMatch(/\\\$/);
    expect(text.startsWith("{\n")).toBe(true);
    expect(text.trimEnd().endsWith("}")).toBe(true);
  });

  it("checks everything customers depend on", () => {
    for (const must of [
      "bridge=netgrid-lan", "name=netgrid-hs ", "name=netgrid-hsprof", "http-pap", "^netgrid-d",
      'comment="netgrid-voucher"', "hotspot/login.html", "hotspot.netgrid", "service-name=netgrid",
      "8.8.8.8", "name=netgrid-sync", 'message~"NetGrid"', "netgrid-ttl-enforce", "masquerade",
    ]) expect(text, must).toContain(must);
  });

  it("reports each finding with a clear status and never changes the router", () => {
    for (const status of ["OK    ", "FAIL  ", "WARN  ", "INFO  "]) expect(text).toContain(status);
    // read-only: no command that adds, removes, sets, enables or disables anything
    expect(strip(text)).not.toMatch(/\/[a-z -]+\s+(add|remove|set|enable|disable|reset|import|execute)\b/);
    expect(strip(text)).not.toMatch(/:execute|:reboot|:shutdown/);
  });

  it("checks the portal host, but only when it is a plain host name", () => {
    expect(text).toContain(":resolve portal.example.com");
    expect(safeHost("portal.example.com:443")).toBe("portal.example.com");
    for (const bad of ['evil";/system reset-configuration', "a b", "x$y", "", null, undefined, "-bad.com"]) {
      expect(safeHost(bad as string | null | undefined), String(bad)).toBeNull();
    }
    expect(buildDoctorPaste('evil";/system reset-configuration')).not.toContain("reset-configuration");
    expect(doctorLines("x$y").join("\n")).not.toContain("x$y");
  });

  it("installs as a versioned script and only when missing or older", () => {
    const install = buildDoctorInstallLines("portal.example.com").join("\n");
    expect(install).toContain(`name=netgrid-doctor comment="${DOCTOR_VERSION}"`);
    expect(install).toContain("source={");
    expect(install).toMatch(/:if \(\[:len \[\/system script find where name=netgrid-doctor comment="v1"\]\] = 0\)/);
    expect(balanced(install)).toBe(true);
    expect(strip(install)).not.toMatch(/\\\$/);
  });
});
