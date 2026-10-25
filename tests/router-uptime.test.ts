// RouterOS reports uptime as a duration ("2d04:05:06"), not seconds. The heartbeat endpoint used to
// read it as a number, so uptime was dropped from every heartbeat.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({ get supabaseAdmin() { return h.db; } }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => "portal.test" }));

import { Route as Heartbeat } from "@/routes/api/public/router/heartbeat.$token";
import { parseRouterOsDuration } from "@/lib/router-health";

describe("parseRouterOsDuration", () => {
  it.each([
    ["00:12:30", 750],
    ["03:04:05", 11045],
    ["2d04:05:06", 2 * 86400 + 4 * 3600 + 5 * 60 + 6],
    ["1w2d03:04:05", 604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5],
    ["3w", 3 * 604800],
    ["5d", 5 * 86400],
    ["86400", 86400],
    ["  86400  ", 86400],
  ])("%s -> %s seconds", (input, secs) => expect(parseRouterOsDuration(input)).toBe(secs));

  it.each([[null], [undefined], [""], ["   "], ["soon"], ["12:30"], ["1d2h"], ["-5"]])("rejects %j", (input) =>
    expect(parseRouterOsDuration(input as string | null | undefined)).toBeNull(),
  );
});

const T = "11111111-1111-1111-1111-111111111111";
const R = "r1000000-0000-0000-0000-000000000001";
const LEGACY = "legacytoken".padEnd(32, "y");

beforeEach(() => {
  h.db = new FakeDb()
    .seed("tenants", [{ id: T, slug: "acme", name: "Acme" }])
    .seed("routers", [
      { id: R, tenant_id: T, name: "Tower", status: "offline", provision_token: LEGACY, provision_token_expires_at: null, legacy_token_auth: true, last_heartbeat_at: null },
    ]);
});
afterEach(() => vi.restoreAllMocks());

describe("heartbeat with the exact query a router sends", () => {
  it("stores uptime, marks the router online and records health metrics", async () => {
    const qs = "?cpu=23&mem-free=412&mem-total=1024&hdd-free=90&uptime=2d04:05:06&temp=41&voltage=24&version=7.14&board=hAP&arch=arm&wan-ip=10.0.0.2/24&latency=18&loss=0&jitter=2&dns=1";
    const res = await call(Heartbeat, "GET", { url: `https://portal.test/hb${qs}`, params: { token: LEGACY }, ip: freshIp() });
    expect(res.status).toBe(200);
    const r = h.db.rows("routers").find((x) => x.id === R)!;
    expect(r.status).toBe("online");
    expect(r.uptime_seconds).toBe(2 * 86400 + 4 * 3600 + 5 * 60 + 6);
    expect(r.cpu_load).toBe(23);
    expect(r.ram_usage).toBe(60);
    expect(r.last_heartbeat_at).toBeTruthy();
    expect(h.db.rows("router_metrics")).toHaveLength(1);
  });

  it("still goes online when uptime is missing or unreadable", async () => {
    const res = await call(Heartbeat, "GET", { url: "https://portal.test/hb?cpu=5&uptime=whenever", params: { token: LEGACY }, ip: freshIp() });
    expect(res.status).toBe(200);
    const r = h.db.rows("routers").find((x) => x.id === R)!;
    expect(r.status).toBe("online");
    expect(r.uptime_seconds ?? null).toBeNull();
  });
});
