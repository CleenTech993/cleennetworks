import { describe, expect, it } from "vitest";
import {
  CONNECTED_WINDOW_MS,
  MAX_PPPOE_SESSIONS_PER_REPORT,
  buildPppoeAgentLines,
  isClientConnected,
  parsePppoeReport,
} from "../src/lib/pppoe-sessions";

describe("parsePppoeReport", () => {
  it("reads username|mac|ip records and normalises the MAC", () => {
    const out = parsePppoeReport(
      "alice|aa-bb-cc-dd-ee-01|10.10.0.2;bob|AA:BB:CC:DD:EE:02|10.10.0.3;",
    );
    expect(out).toEqual([
      { username: "alice", mac: "AA:BB:CC:DD:EE:01", ip: "10.10.0.2" },
      { username: "bob", mac: "AA:BB:CC:DD:EE:02", ip: "10.10.0.3" },
    ]);
  });

  it("accepts newlines as separators and tolerates empty input", () => {
    expect(
      parsePppoeReport("alice|AA:BB:CC:DD:EE:01|10.0.0.2\nbob|AA:BB:CC:DD:EE:02|10.0.0.3"),
    ).toHaveLength(2);
    expect(parsePppoeReport("")).toEqual([]);
    expect(parsePppoeReport(";;;")).toEqual([]);
  });

  it("keeps the client but drops a malformed IP", () => {
    const [r] = parsePppoeReport("alice|AA:BB:CC:DD:EE:01|999.1.1.1");
    expect(r).toMatchObject({ username: "alice", ip: null });
    expect(parsePppoeReport("alice|AA:BB:CC:DD:EE:01|")[0].ip).toBeNull();
  });

  it.each([
    ["wrong number of fields", "alice|AA:BB:CC:DD:EE:01"],
    ["too many fields", "alice|AA:BB:CC:DD:EE:01|10.0.0.2|extra"],
    ["not a MAC", "alice|nonsense|10.0.0.2"],
    ["IP in place of the MAC (L2TP/PPTP caller-id)", "alice|10.0.0.9|10.0.0.2"],
    ["all-zero MAC", "alice|00:00:00:00:00:00|10.0.0.2"],
    ["multicast MAC", "alice|01:00:5E:00:00:01|10.0.0.2"],
    ["username with spaces", "al ice|AA:BB:CC:DD:EE:01|10.0.0.2"],
    ["username with quotes", 'al"ice|AA:BB:CC:DD:EE:01|10.0.0.2'],
    ["username with a script fragment", "a$(x)|AA:BB:CC:DD:EE:01|10.0.0.2"],
    ["empty username", "|AA:BB:CC:DD:EE:01|10.0.0.2"],
    ["username too long", `${"a".repeat(65)}|AA:BB:CC:DD:EE:01|10.0.0.2`],
  ])("drops a record with %s", (_label, rec) => {
    expect(parsePppoeReport(rec)).toEqual([]);
  });

  it("never reports a name containing a separator as itself", () => {
    // "|" and ";" split records and are not allowed in a name, so "ev;il" can only ever surface as the
    // separate record "il" (which must then match a real client to have any effect), never as "ev;il".
    const names = parsePppoeReport("ev;il|AA:BB:CC:DD:EE:01|1.1.1.1").map((r) => r.username);
    expect(names).toEqual(["il"]);
    expect(parsePppoeReport("a|b|AA:BB:CC:DD:EE:01|1.1.1.1")).toEqual([]);
  });

  it("keeps only the first record for a repeated username", () => {
    const out = parsePppoeReport(
      "alice|AA:BB:CC:DD:EE:01|10.0.0.2;alice|AA:BB:CC:DD:EE:02|10.0.0.3",
    );
    expect(out).toHaveLength(1);
    expect(out[0].mac).toBe("AA:BB:CC:DD:EE:01");
  });

  it("caps the number of records per report", () => {
    const body = Array.from({ length: MAX_PPPOE_SESSIONS_PER_REPORT + 50 }, (_, i) => {
      const hex = (i + 1).toString(16).padStart(6, "0");
      return `user${i}|AA:BB:CC:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}|10.0.0.1;`;
    }).join("");
    expect(parsePppoeReport(body)).toHaveLength(MAX_PPPOE_SESSIONS_PER_REPORT);
  });
});

describe("isClientConnected", () => {
  const now = Date.UTC(2026, 9, 25, 12, 0, 0);
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("is connected while the last report is recent", () => {
    expect(isClientConnected(ago(30_000), now)).toBe(true);
    expect(isClientConnected(ago(CONNECTED_WINDOW_MS - 1), now)).toBe(true);
  });
  it("is not connected once the reports stop", () => {
    expect(isClientConnected(ago(CONNECTED_WINDOW_MS), now)).toBe(false);
    expect(isClientConnected(ago(60 * 60_000), now)).toBe(false);
  });
  it("is not connected when never seen or the value is unusable", () => {
    expect(isClientConnected(null, now)).toBe(false);
    expect(isClientConnected(undefined, now)).toBe(false);
    expect(isClientConnected("not a date", now)).toBe(false);
  });
});

describe("buildPppoeAgentLines", () => {
  const URL = "https://portal.example.com/api/public/router/pppoe/abcDEF123_-token";
  const script = buildPppoeAgentLines(URL).join("\n");

  it("installs a script and a 2 minute scheduler named netgrid-pppoe", () => {
    expect(script).toContain("add name=netgrid-pppoe source={");
    expect(script).toContain(
      '/system scheduler add name=netgrid-pppoe interval=2m on-event="/system script run netgrid-pppoe"',
    );
  });

  it("creates the scheduler only when missing, so its timer is not reset on every sync", () => {
    expect(script).toMatch(
      /:if \(\[:len \[\/system scheduler find where name=netgrid-pppoe\]\] = 0\) do=\{ \/system scheduler add/,
    );
  });

  it("reports only PPPoE sessions, with MAC (caller-id) and address", () => {
    expect(script).toContain("/ppp active find where service=pppoe");
    expect(script).toContain("caller-id");
    expect(script).toContain("address");
  });

  it("posts to the router's own URL, and in batches so a long list cannot overflow a RouterOS string", () => {
    expect(script.split(URL).length - 1).toBe(2); // in-loop batch + final flush
    expect(script).toContain("[:len \\$d] > 3000"); // "$" is escaped as "\\$" in the emitted source
  });

  it("escapes every $ the way RouterOS needs inside a braced script source", () => {
    const source = script.slice(script.indexOf("source={") + 8);
    expect(source).toMatch(/\\\$/);
    expect(source.replace(/\\\$/g, "")).not.toContain("$");
  });

  it("leaves no placeholder or comment lines in the emitted script", () => {
    expect(script).not.toContain("__URL__");
    expect(script.split("\n").some((l) => l.trim().startsWith("#"))).toBe(false);
  });

  it("has balanced braces, so the import cannot break the rest of the sync script", () => {
    const body = script.slice(script.indexOf("source={"));
    const open = (body.match(/\{/g) ?? []).length;
    const close = (body.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
  });

  it.each([
    ["http", "http://portal.example.com/api/public/router/pppoe/abc"],
    ["a different path", "https://portal.example.com/api/public/router/devices/abc"],
    [
      "a quote that could break out of the script",
      'https://portal.example.com/api/public/router/pppoe/abc"; /system reset-configuration; "',
    ],
    ["a space", "https://portal.example.com/api/public/router/pppoe/a bc"],
    ["empty", ""],
  ])("refuses a push URL with %s (installs nothing)", (_l, url) => {
    expect(buildPppoeAgentLines(url)).toEqual([]);
  });
});
