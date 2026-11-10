import { describe, expect, it } from "vitest";
import {
  buildBlockLines,
  buildCustomerEgressFilterLines,
  canResumeVoucher,
  buildDeviceAgentLines,
  buildHotspotSuspendLines,
  buildHotspotVoucherRefreshLines,
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
        bytesIn: null,
        bytesOut: null,
      },
      {
        mac: "AA:BB:CC:DD:EE:04",
        ip: "10.5.50.21",
        hostname: null,
        user: null,
        authorized: false,
        tether: true,
        bytesIn: null,
        bytesOut: null,
      },
    ]);
  });

  it("parses safe hotspot byte counters for live throughput sampling", () => {
    expect(
      parseDeviceReport("AA:BB:CC:DD:EE:02|10.5.50.20|phone|ABCDEF2345|true|0|12000|24000"),
    ).toMatchObject([{ bytesIn: "12000", bytesOut: "24000" }]);
    expect(
      parseDeviceReport("AA:BB:CC:DD:EE:02|10.5.50.20|phone|ABCDEF2345|true|0|invalid|1"),
    ).toEqual([]);
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
    expect(out).toContain(
      "add name=netgrid-d1 shared-users=1 idle-timeout=none keepalive-timeout=none session-timeout=0s",
    );
  });

  it("adds MAC authentication only for the MAC bound to a live one-device voucher", () => {
    const out = joined([
      { code: "BOUND000001", bound_mac: "AA:BB:CC:DD:EE:02", limit: 1 },
      { code: "FAMILY0001", bound_mac: "AA:BB:CC:DD:EE:03", limit: 3 },
      { code: "UNBOUND001", bound_mac: null, limit: 1 },
    ]);

    expect(out).toContain(
      "login-by=http-chap,http-pap,mac-cookie,mac mac-auth-mode=mac-as-username mac-auth-password=",
    );
    expect(out).toContain(
      'add name="AA:BB:CC:DD:EE:02" password="" server=netgrid-hs profile=netgrid-d1 mac-address=AA:BB:CC:DD:EE:02 comment="netgrid-mac-voucher"',
    );
    expect(out).not.toContain('add name="AA:BB:CC:DD:EE:03"');
    expect(out).not.toContain('add name="UNBOUND001" password=""');
  });

  it("removes managed MAC logins and sessions when the bound voucher is no longer live", () => {
    const out = joined([]);

    expect(out).toContain(':local ngCurrentMacUsers [:toarray "#"]');
    expect(out).toContain('find where comment="netgrid-mac-voucher"');
    expect(out).toContain("/ip hotspot active remove [find where user=$ngMac]");
  });

  it("disconnects sessions only when their managed voucher is no longer live", () => {
    const out = joined([{ code: "LIVE000001", bound_mac: null, limit: 1 }]);
    expect(out).toContain(':local ngCurrentVouchers [:toarray "LIVE000001"]');
    expect(out).toContain("/ip hotspot active");
    expect(out).toContain('[:typeof [:find $ngCurrentVouchers $ngCode]] = "nil"');
    expect(out).toContain("remove $ngActive");
    expect(out).toContain('find where comment="netgrid-voucher"');
  });

  it("keeps live voucher users in place during sync so active sessions are not restarted", () => {
    const out = joined([{ code: "LIVE000001", bound_mac: "AA:BB:CC:DD:EE:02", limit: 1 }]);
    expect(out).not.toContain('remove [find where comment="netgrid-voucher"]');
    expect(out).toContain(':if ([:len [find where name="LIVE000001"]] = 0) do={');
    expect(out).toContain(
      'set [find where name="LIVE000001"] server=netgrid-hs profile=netgrid-d1 mac-address=AA:BB:CC:DD:EE:02 comment="netgrid-voucher"',
    );
    expect(out).toContain(
      ':if ([:typeof [:find $ngCurrentVouchers $ngCode]] = "nil") do={ remove $ngActive }',
    );
  });

  describe("buildHotspotSuspendLines", () => {
    it("disconnects current managed hotspot sessions before removing managed users", () => {
      const lines = buildHotspotSuspendLines().join("\n");
      expect(lines).toContain("/ip hotspot active remove [find where user=$n]");
      expect(lines).toContain(':do { remove [find where comment="netgrid-voucher"] }');
      expect(lines.indexOf("/ip hotspot active remove")).toBeLessThan(
        lines.indexOf(':do { remove [find where comment="netgrid-voucher"] }'),
      );
    });
  });

  it("does not pin a multi-device voucher but caps simultaneous devices", () => {
    const out = joined([{ code: "FAMILY0001", bound_mac: "AA:BB:CC:DD:EE:02", limit: 3 }]);
    expect(out).toContain("profile=netgrid-d3");
    expect(out).toContain(
      "add name=netgrid-d3 shared-users=3 idle-timeout=none keepalive-timeout=none session-timeout=0s",
    );
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

  it("defines profiles before adding missing users and updates existing users", () => {
    const lines = buildHotspotUserLines([{ code: "ORDER00001", bound_mac: null, limit: 2 }]);
    const idx = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(idx("add name=netgrid-d2")).toBeLessThan(idx('add name="ORDER00001"'));
    expect(idx('add name="ORDER00001"')).toBeLessThan(idx('set [find where name="ORDER00001"]'));
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

describe("buildHotspotVoucherRefreshLines", () => {
  it("refreshes managed users without rebuilding the list or interrupting active sessions", () => {
    const lines = buildHotspotVoucherRefreshLines([
      { code: "FASTCODE01", bound_mac: "AA:BB:CC:DD:EE:02", limit: 1 },
      { code: 'bad"code', bound_mac: null, limit: 1 },
    ]);
    const script = lines.join("\n");
    expect(script).toContain('find where name="FASTCODE01"');
    expect(script).toContain(
      'set [find where name="FASTCODE01" comment="netgrid-voucher"] server=netgrid-hs profile=netgrid-d1 mac-address=AA:BB:CC:DD:EE:02',
    );
    expect(script).toContain("idle-timeout=none keepalive-timeout=none session-timeout=0s");
    expect(script).toContain("/ip hotspot active");
    expect(script).toContain('[:toarray "FASTCODE01"]');
    expect(script).toContain("mac-address=AA:BB:CC:DD:EE:02");
    expect(script).toContain("remove $ngActive");
    expect(script).toContain('find where comment="netgrid-voucher"');
    expect(script).toContain("mac-auth-mode=mac-as-username");
    expect(script).toContain(
      'add name="AA:BB:CC:DD:EE:02" password="" server=netgrid-hs profile=netgrid-d1',
    );
    expect(script).toContain('find where comment="netgrid-mac-voucher"');
    expect(script).not.toContain('bad"code');
    expect(balanced(script)).toBe(true);
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

describe("buildCustomerEgressFilterLines", () => {
  it("blocks common explicit tunnel protocols on both managed customer subnets only", () => {
    const lines = buildCustomerEgressFilterLines();
    const script = lines.join("\n");
    expect(lines[0]).toBe("/ip firewall filter");
    expect(script).toContain('comment~"^netgrid-egress-"');
    for (const address of ["10.5.50.0/24", "10.10.0.0/24"]) {
      expect(script).toContain(`src-address=${address} out-interface=ether1`);
    }
    expect(script).toContain("protocol=tcp dst-port=22,1194,1723 action=drop");
    expect(script).toContain("protocol=udp dst-port=500,1194,1701,4500,51820 action=drop");
    expect(script).toContain("protocol=gre action=drop");
    expect(script).toContain("protocol=ipsec-esp action=drop");
    expect(script).not.toContain("dst-port=443");
    expect(script).not.toContain("chain=input");
    expect(script.match(/place-before=0/g)).toHaveLength(8);
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

  it("writes variables as plain $ in the braced script source (like the scripts that have always worked) and keeps the syntax balanced", () => {
    const lines = buildDeviceAgentLines(URL_OK);
    const script = lines.find((l) => l.includes("add name=netgrid-devices"))!;
    expect(script).toContain(URL_OK);
    // "\$" is only valid inside a quoted string; inside a braced source it would be a syntax error
    expect(script.match(/\\\$/g)).toBeNull();
    const plain = script;
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
      l.includes("add name=netgrid-devices"),
    )!;
    expect(script.split("\n").filter((l) => l.trim().startsWith("#"))).toEqual([]);
    expect(script).toContain("$c ~"); // the sanitiser itself is still there
  });

  it("creates the scheduler only when missing (re-creating it every sync would reset its timer)", () => {
    const sched = buildDeviceAgentLines(URL_OK).find((l) => l.includes("scheduler add"))!;
    expect(sched).toMatch(
      /^:do \{ :if \(\[:len \[\/system scheduler find where name=netgrid-devices\]\] = 0\)/,
    );
    expect(sched).toContain("interval=1m");
  });

  it("posts the report to the endpoint it parses", () => {
    const plain = buildDeviceAgentLines(URL_OK).join("\n").replace(/\\\$/g, "$");
    expect(plain).toContain(`/tool fetch url="${URL_OK}" http-method=post http-data=$d`);
    // the record layout the script builds is the one parseDeviceReport reads
    expect(plain).toContain(
      '$mac . "|" . $ip . "|" . $hn . "|" . $usr . "|" . $au . "|" . $tt . "|" . $bi . "|" . $bo',
    );
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
