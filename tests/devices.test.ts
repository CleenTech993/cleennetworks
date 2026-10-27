import { describe, expect, it } from "vitest";
import {
  buildBlockLines,
  canResumeVoucher,
  buildDeviceAgentLines,
  buildHotspotUserLines,
  buildTetherLines,
  deviceLimitOf,
  MAX_DEVICES_PER_REPORT,
  parseDeviceReport,
} from "../src/lib/devices";

const URL_OK = "https://app.example.com/api/public/router/devices/abc123_TOKEN-x";

/** Counts brackets outside of double-quoted strings (RouterOS strings use \" and \\ escapes). */
function balanced(text: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { "}": "{", ")": "(", "]": "[" };
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if ("{([".includes(c)) stack.push(c);
    else if (c in pairs && stack.pop() !== pairs[c]) return false;
  }
  return !inStr && stack.length === 0;
}

describe("deviceLimitOf", () => {
  it("defaults to one device and clamps to 1-10", () => {
    expect(deviceLimitOf(null)).toBe(1);
    expect(deviceLimitOf({ device_limit: null })).toBe(1);
    expect(deviceLimitOf({ device_limit: 0 })).toBe(1);
    expect(deviceLimitOf({ device_limit: -4 })).toBe(1);
    expect(deviceLimitOf({ device_limit: 3 })).toBe(3);
    expect(deviceLimitOf({ device_limit: 99 })).toBe(10);
    expect(deviceLimitOf({ device_limit: 2.9 })).toBe(2);
  });
});

describe("parseDeviceReport", () => {
  it("parses well-formed records", () => {
    const r = parseDeviceReport(
      "aa:bb:cc:dd:ee:02|10.5.50.20|Johns-iPhone|ABCDEF2345|true|0;AA:BB:CC:DD:EE:04|10.5.50.21|||false|1;",
    );
    expect(r).toEqual([
      {
        mac: "AA:BB:CC:DD:EE:02",
        ip: "10.5.50.20",
        hostname: "Johns-iPhone",
        user: "ABCDEF2345",
        authorized: true,
        tether: false,
      },
      {
        mac: "AA:BB:CC:DD:EE:04",
        ip: "10.5.50.21",
        hostname: null,
        user: null,
        authorized: false,
        tether: true,
      },
    ]);
  });

  it("drops malformed, multicast, zero and duplicate MACs", () => {
    const r = parseDeviceReport(
      [
        "nonsense",
        "01:00:5E:00:00:01|10.0.0.1|x||false|0",
        "00:00:00:00:00:00|10.0.0.2|x||false|0",
        "AA:BB:CC:DD:EE:02|10.0.0.3|a||false|0",
        "AA:BB:CC:DD:EE:02|10.0.0.4|b||false|0",
        "AA:BB:CC|10.0.0.5|c||false|0",
      ].join(";"),
    );
    expect(r.map((x) => x.mac)).toEqual(["AA:BB:CC:DD:EE:02"]);
    expect(r[0]!.ip).toBe("10.0.0.3");
  });

  it("neutralises hostile hostnames, users and IPs chosen by the customer's device", () => {
    const [d] = parseDeviceReport(
      'AA:BB:CC:DD:EE:02|999.1.1.1|x"$(evil) /system reset|bad user!|true|0',
    );
    expect(d!.ip).toBeNull();
    expect(d!.user).toBeNull();
    expect(d!.hostname).not.toMatch(/["$();/]/);
    expect(d!.hostname!.length).toBeLessThanOrEqual(64);
  });

  it("drops records with the wrong number of fields (a forged delimiter in a name cannot add devices)", () => {
    // a hostname "x;AA:..:99|1.1.1.1|y" turns one record into a fragment plus a fake record
    expect(
      parseDeviceReport("AA:BB:CC:DD:EE:02|10.0.0.1|x;AA:BB:CC:DD:EE:99|1.1.1.1|y|||false|0"),
    ).toEqual([]);
    expect(parseDeviceReport("AA:BB:CC:DD:EE:02|10.0.0.1|h||false")).toEqual([]); // too few
    expect(parseDeviceReport("AA:BB:CC:DD:EE:02|10.0.0.1|h||false|0|extra")).toEqual([]); // too many
  });

  it("caps the number of devices per report", () => {
    const body = Array.from({ length: 500 }, (_, i) => {
      const hex = i.toString(16).padStart(4, "0");
      return `AA:BB:CC:DD:${hex.slice(0, 2)}:${hex.slice(2)}|10.0.0.1|h||false|0`;
    }).join(";");
    expect(parseDeviceReport(body)).toHaveLength(MAX_DEVICES_PER_REPORT);
  });
});

describe("buildHotspotUserLines diagnostics", () => {
  const voucher = (code: string) => ({ code, bound_mac: null, limit: 1 });

  it("logs a warning when fewer voucher users exist on the router than were sent", () => {
    const out = buildHotspotUserLines([voucher("AAAA111111"), voucher("BBBB222222")]).join("\n");
    expect(out).toContain(":local ngWant 2");
    expect(out).toContain('[/ip hotspot user find comment="netgrid-voucher"]');
    expect(out).toContain(":log warning");
    expect(out).toContain("hotspot server netgrid-hs");
    // the check runs after every voucher has been added
    expect(out.lastIndexOf('add name="BBBB222222"')).toBeLessThan(out.indexOf(":local ngWant"));
  });

  it("only counts vouchers that were really emitted (unsafe codes are skipped)", () => {
    const out = buildHotspotUserLines([voucher("GOOD123456"), voucher('bad"code')]).join("\n");
    expect(out).toContain(":local ngWant 1");
  });

  it("adds no check when there are no vouchers", () => {
    expect(buildHotspotUserLines([]).join("\n")).not.toContain("ngWant");
  });
});

describe("buildHotspotUserLines", () => {
  const joined = (v: Parameters<typeof buildHotspotUserLines>[0]) =>
    buildHotspotUserLines(v).join("\n");

  it("pins a one-device voucher to its MAC and uses the 1-device profile", () => {
    const out = joined([{ code: "ABC123XYZ9", bound_mac: "AA:BB:CC:DD:EE:02", limit: 1 }]);
    expect(out).toContain(
      'add name="ABC123XYZ9" password="ABC123XYZ9" server=netgrid-hs profile=netgrid-d1 mac-address=AA:BB:CC:DD:EE:02',
    );
    expect(out).toContain("add name=netgrid-d1 shared-users=1");
  });

  it("does not pin a multi-device voucher but caps simultaneous devices", () => {
    const out = joined([{ code: "FAMILY0001", bound_mac: "AA:BB:CC:DD:EE:02", limit: 3 }]);
    expect(out).toContain("profile=netgrid-d3");
    expect(out).toContain("add name=netgrid-d3 shared-users=3");
    expect(out).not.toContain("mac-address=AA:BB");
  });

  it("leaves an unbound voucher unpinned and ignores an invalid MAC", () => {
    const out = joined([
      { code: "FRESH00001", bound_mac: null, limit: 1 },
      { code: "BADMAC0001", bound_mac: "01:00:5E:00:00:01", limit: 1 },
    ]);
    expect(out).not.toContain("mac-address=");
  });

  it("skips codes that are not script-safe", () => {
    const out = joined([
      { code: 'EVIL"; /x', bound_mac: null, limit: 1 },
      { code: "GOOD000001", bound_mac: null, limit: 1 },
    ]);
    expect(out).not.toContain("EVIL");
    expect(out).toContain("GOOD000001");
  });

  it("removes old users, then defines profiles, then adds users (order matters on the router)", () => {
    const lines = buildHotspotUserLines([{ code: "ORDER00001", bound_mac: null, limit: 2 }]);
    const idx = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(idx('remove [find comment="netgrid-voucher"]')).toBeLessThan(idx("add name=netgrid-d1"));
    expect(idx("add name=netgrid-d2")).toBeLessThan(idx('add name="ORDER00001"'));
  });

  it("emits balanced RouterOS syntax", () => {
    expect(
      balanced(
        joined([
          { code: "OKCODE0001", bound_mac: "AA:BB:CC:DD:EE:02", limit: 1 },
          { code: "OKCODE0002", bound_mac: null, limit: 4 },
        ]),
      ),
    ).toBe(true);
  });
});

describe("buildBlockLines", () => {
  it("blocks each valid MAC once and drops its running session", () => {
    const out = buildBlockLines(["AA:BB:CC:DD:EE:02", "AA:BB:CC:DD:EE:02", "garbage"]).join("\n");
    expect(out.match(/type=blocked/g)).toHaveLength(1);
    expect(out).toContain("/ip hotspot active remove [find where mac-address=AA:BB:CC:DD:EE:02]");
    expect(balanced(out)).toBe(true);
  });
  it("still clears old blocks when nothing is blocked", () => {
    expect(buildBlockLines([]).join("\n")).toContain('remove [find where comment="netgrid-block"]');
  });
});

describe("buildTetherLines", () => {
  it("always detects TTL 63 and 127, and enforces TTL=1 only when switched on", () => {
    const on = buildTetherLines(true).join("\n");
    const off = buildTetherLines(false).join("\n");
    for (const out of [on, off]) {
      expect(out).toContain("ttl=equal:63");
      expect(out).toContain("ttl=equal:127");
      expect(out).toContain("address-list=netgrid-tether");
      expect(balanced(out)).toBe(true);
    }
    expect(on).toContain("action=change-ttl new-ttl=set:1");
    expect(on).toContain("out-interface=netgrid-lan");
    expect(on).toContain("fasttrack-connection");
    expect(off).not.toContain("change-ttl");
  });
  it("rebuilds its rules from scratch so flipping the switch takes effect", () => {
    expect(buildTetherLines(false)[1]).toContain('remove [find where comment~"^netgrid-ttl"]');
  });
});

describe("buildDeviceAgentLines", () => {
  it("refuses a URL that is not the platform's device endpoint", () => {
    expect(
      buildDeviceAgentLines(
        'https://x.com/api/public/router/devices/t"; /system reset-configuration',
      ),
    ).toEqual([]);
    expect(buildDeviceAgentLines("http://x.com/api/public/router/devices/t")).toEqual([]);
    expect(buildDeviceAgentLines("https://x.com/other/t")).toEqual([]);
  });

  it("escapes every $ in the braced script source and keeps the syntax balanced", () => {
    const lines = buildDeviceAgentLines(URL_OK);
    const script = lines.find((l) => l.startsWith("add name=netgrid-devices"))!;
    expect(script).toContain(URL_OK);
    // no unescaped dollar anywhere in the source
    expect(script.match(/(^|[^\\])\$/g)).toBeNull();
    // un-escaping gives back plain RouterOS code that still parses as balanced
    const plain = script.replace(/\\\$/g, "$");
    expect(plain).toContain(":foreach h in=[/ip hotspot host find]");
    expect(balanced(plain)).toBe(true);
    expect(balanced(lines.join("\n").replace(/\\\$/g, "$"))).toBe(true);
  });

  it("strips everything but plain characters from the hostname before building a record", () => {
    const plain = buildDeviceAgentLines(URL_OK).join("\n").replace(/\\\$/g, "$");
    const m = plain.match(/\$c ~ "([^"]+)"/);
    expect(m).not.toBeNull();
    const safe = new RegExp(m![1]!);
    for (const ok of ["a", "Z", "7", ".", "_", "-", " "]) expect(safe.test(ok)).toBe(true);
    for (const bad of ["|", ";", '"', "$", "\\", "(", ")", "/", "\n", "é"])
      expect(safe.test(bad)).toBe(false);
    // the sanitiser runs before the hostname is concatenated into the report
    expect(plain.indexOf("$c ~")).toBeLessThan(plain.indexOf('$d . $mac . "|"'));
  });

  it("sends no comment lines to the router", () => {
    const script = buildDeviceAgentLines(URL_OK).find((l) =>
      l.startsWith("add name=netgrid-devices"),
    )!;
    expect(script.split("\n").filter((l) => l.trim().startsWith("#"))).toEqual([]);
    expect(script).toContain("$c ~".replace("$", "\\$")); // the sanitiser itself is still there
  });

  it("creates the scheduler only when missing (re-creating it every sync would reset its timer)", () => {
    const sched = buildDeviceAgentLines(URL_OK).find((l) => l.includes("scheduler add"))!;
    expect(sched).toMatch(
      /^:if \(\[:len \[\/system scheduler find where name=netgrid-devices\]\] = 0\)/,
    );
    expect(sched).toContain("interval=2m");
  });

  it("posts the report to the endpoint it parses", () => {
    const plain = buildDeviceAgentLines(URL_OK).join("\n").replace(/\\\$/g, "$");
    expect(plain).toContain(`/tool fetch url="${URL_OK}" http-method=post http-data=$d`);
    // the record layout the script builds is the one parseDeviceReport reads
    expect(plain).toContain('$mac . "|" . $ip . "|" . $hn . "|" . $usr . "|" . $au . "|" . $tt');
  });
});

describe("canResumeVoucher", () => {
  const MAC = "AA:BB:CC:DD:EE:01";
  it("lets the device that redeemed a one-device voucher present it again", () => {
    expect(canResumeVoucher(1, MAC, MAC)).toBe(true);
  });
  it("never lets another device, or an unidentified one, take over a one-device voucher", () => {
    expect(canResumeVoucher(1, "AA:BB:CC:DD:EE:02", MAC)).toBe(false);
    expect(canResumeVoucher(1, null, MAC)).toBe(false);
    expect(canResumeVoucher(1, MAC, null)).toBe(false);
    expect(canResumeVoucher(1, null, null)).toBe(false);
  });
  it("lets any device use a multi-device voucher (the router enforces the limit)", () => {
    expect(canResumeVoucher(3, "AA:BB:CC:DD:EE:02", MAC)).toBe(true);
    expect(canResumeVoucher(3, null, null)).toBe(true);
  });
});
