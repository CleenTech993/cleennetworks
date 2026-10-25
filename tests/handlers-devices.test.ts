import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({ get supabaseAdmin() { return h.db; } }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => "portal.test" }));

import { Route as Devices } from "@/routes/api/public/router/devices.$token";
import { Route as Sync } from "@/routes/api/public/router/sync.$token";
import { issueDeviceToken } from "@/lib/router-auth.server";

const T = "11111111-1111-1111-1111-111111111111";
const OTHER_T = "99999999-9999-9999-9999-999999999999";
const R1 = "r1000000-0000-0000-0000-000000000001";
const R3 = "r3000000-0000-0000-0000-000000000003";
const P1 = "p1000000-0000-0000-0000-000000000001"; // one device, 1 hour
const P3 = "p3000000-0000-0000-0000-000000000003"; // three devices
const MAC_A = "AA:BB:CC:DD:EE:02";
const MAC_B = "AA:BB:CC:DD:EE:04";
const MAC_TV = "AA:BB:CC:DD:EE:70";

const rec = (mac: string, ip: string, host: string, user: string, auth: boolean, tether = 0) =>
  `${mac}|${ip}|${host}|${user}|${auth}|${tether};`;
const send = (token: string, body: string) => call(Devices, "POST", { params: { token }, rawBody: body, ip: freshIp() });
const voucher = (code: string) => h.db.rows("vouchers").find((v) => v.code === code)!;
const devices = () => h.db.rows("router_devices");

beforeEach(() => {
  h.db = new FakeDb()
    .seed("tenants", [{ id: T, slug: "acme", name: "Acme ISP" }, { id: OTHER_T, slug: "rival", name: "Rival" }])
    .seed("routers", [
      { id: R1, tenant_id: T, name: "Tower 1", status: "online", provision_token: "boot".padEnd(32, "x"), legacy_token_auth: false, block_tethering: true },
      { id: R3, tenant_id: OTHER_T, name: "Rival", status: "online", provision_token: "rival".padEnd(32, "z"), legacy_token_auth: false, block_tethering: true },
    ])
    .seed("packages", [
      { id: P1, tenant_id: T, kind: "hotspot", device_limit: 1, duration_value: 1, duration_unit: "hours" },
      { id: P3, tenant_id: T, kind: "voucher", device_limit: 3, duration_value: 1, duration_unit: "days" },
    ])
    .seed("vouchers", [
      { id: "v1", tenant_id: T, package_id: P1, code: "ONEDEV0001", status: "unused", payment_id: null, expires_at: null, bound_mac: null },
      { id: "v2", tenant_id: T, package_id: P1, code: "USEDFREE01", status: "used", payment_id: null, expires_at: null, bound_mac: null },
      { id: "v3", tenant_id: T, package_id: P3, code: "FAMILY0003", status: "unused", payment_id: null, expires_at: null, bound_mac: null },
      { id: "v4", tenant_id: T, package_id: P1, code: "PINNED0001", status: "used", payment_id: null, expires_at: null, bound_mac: MAC_B },
      { id: "v5", tenant_id: OTHER_T, package_id: null, code: "RIVALCODE2", status: "unused", payment_id: null, expires_at: null, bound_mac: null },
    ])
    .seed("tv_devices", [{ id: "tv1", tenant_id: T, mac_address: MAC_TV, status: "active" }]);
});
afterEach(() => vi.restoreAllMocks());

describe("device report endpoint", () => {
  it("needs a valid router token and writes nothing without one", async () => {
    const res = await send("x".repeat(43), rec(MAC_A, "10.5.50.20", "phone", "", false));
    expect(res.status).toBe(404);
    expect(devices()).toHaveLength(0);
  });

  it("stores devices against the authenticated router and its tenant only", async () => {
    const token = await issueDeviceToken(R1);
    const res = await send(token, rec(MAC_A, "10.5.50.20", "Johns-iPhone", "", false) + rec(MAC_B, "10.5.50.21", "tablet", "", false, 1));
    expect(res.status).toBe(200);
    expect(devices()).toHaveLength(2);
    expect(devices().every((d) => d.router_id === R1 && d.tenant_id === T)).toBe(true);
    expect(devices().find((d) => d.mac === MAC_B)!.tether_suspected).toBe(true);
    expect(devices().find((d) => d.mac === MAC_A)!.registered_kind).toBeNull();
  });

  it("keeps the blocked flag and first-seen time when a device reports again", async () => {
    const token = await issueDeviceToken(R1);
    await send(token, rec(MAC_A, "10.5.50.20", "phone", "", false));
    const row = devices().find((d) => d.mac === MAC_A)!;
    row.blocked = true;
    const firstSeen = row.first_seen_at;
    await send(token, rec(MAC_A, "10.5.50.99", "phone", "", false));
    const after = devices().filter((d) => d.mac === MAC_A);
    expect(after).toHaveLength(1);
    expect(after[0]!.blocked).toBe(true);
    expect(after[0]!.first_seen_at).toBe(firstSeen);
    expect(after[0]!.ip).toBe("10.5.50.99");
  });

  it("recognises a paid smart TV as registered", async () => {
    const token = await issueDeviceToken(R1);
    await send(token, rec(MAC_TV, "10.5.50.30", "LG-TV", "", false));
    expect(devices()[0]!.registered_kind).toBe("tv");
  });

  it("redeems and pins a one-device voucher that was logged in directly on the router", async () => {
    const token = await issueDeviceToken(R1);
    await send(token, rec(MAC_A, "10.5.50.20", "phone", "ONEDEV0001", true));
    const v = voucher("ONEDEV0001");
    expect(v.status).toBe("used");
    expect(v.bound_mac).toBe(MAC_A);
    expect(v.used_by_mac).toBe(MAC_A);
    // the usage clock started now: 1 hour package
    expect(Math.abs(new Date(v.expires_at as string).getTime() - Date.now() - 3_600_000)).toBeLessThan(5_000);
    const d = devices()[0]!;
    expect(d.registered_kind).toBe("voucher");
    expect(d.voucher_code).toBe("ONEDEV0001");
  });

  it("does not pin a voucher whose package allows several devices", async () => {
    const token = await issueDeviceToken(R1);
    await send(token, rec(MAC_A, "10.5.50.20", "phone", "FAMILY0003", true));
    expect(voucher("FAMILY0003").status).toBe("used");
    expect(voucher("FAMILY0003").bound_mac).toBeNull();
  });

  it("pins an already-used voucher to the first device seen, and never overwrites an existing pin", async () => {
    const token = await issueDeviceToken(R1);
    await send(token, rec(MAC_A, "10.5.50.20", "phone", "USEDFREE01", true));
    expect(voucher("USEDFREE01").bound_mac).toBe(MAC_A);
    await send(token, rec(MAC_A, "10.5.50.20", "phone", "PINNED0001", true));
    expect(voucher("PINNED0001").bound_mac).toBe(MAC_B);
  });

  it("links a device to its voucher by the pinned MAC even when it is not logged in", async () => {
    const token = await issueDeviceToken(R1);
    await send(token, rec(MAC_B, "10.5.50.21", "tablet", "", false));
    expect(devices()[0]!.voucher_code).toBe("PINNED0001");
    expect(devices()[0]!.registered_kind).toBe("voucher");
  });

  it("ignores sessions that are not authorised and vouchers of other tenants", async () => {
    const token = await issueDeviceToken(R1);
    await send(token, rec(MAC_A, "10.5.50.20", "phone", "ONEDEV0001", false) + rec(MAC_B, "10.5.50.21", "x", "RIVALCODE2", true));
    expect(voucher("ONEDEV0001").status).toBe("unused");
    expect(voucher("RIVALCODE2").status).toBe("unused");
    expect(voucher("RIVALCODE2").bound_mac).toBeNull();
  });

  it("cannot be tricked by a device name that contains the record separators", async () => {
    const token = await issueDeviceToken(R1);
    const forged = `${MAC_A}|10.5.50.20|x;${MAC_B}|10.5.50.21|y|ONEDEV0001|true|0|false|0;`;
    await send(token, forged);
    expect(voucher("ONEDEV0001").status).toBe("unused");
    expect(devices()).toHaveLength(0);
  });

  it("forgets devices not seen for 30 days, on this router only", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    h.db.seed("router_devices", [
      { id: "d-old", tenant_id: T, router_id: R1, mac: "AA:BB:CC:00:00:01", last_seen_at: old },
      { id: "d-old-other", tenant_id: OTHER_T, router_id: R3, mac: "AA:BB:CC:00:00:02", last_seen_at: old },
    ]);
    const token = await issueDeviceToken(R1);
    await send(token, rec(MAC_A, "10.5.50.20", "phone", "", false));
    const macs = devices().map((d) => d.mac);
    expect(macs).not.toContain("AA:BB:CC:00:00:01");
    expect(macs).toContain("AA:BB:CC:00:00:02");
    expect(macs).toContain(MAC_A);
  });
});

describe("sync script: device features", () => {
  const sync = async (token: string) => (await call(Sync, "GET", { params: { token }, ip: freshIp() })).text();

  it("pins one-device vouchers to their MAC and caps shared ones", async () => {
    const text = await sync(await issueDeviceToken(R1));
    expect(text).toContain(`add name="PINNED0001" password="PINNED0001" server=netgrid-hs profile=netgrid-d1 mac-address=${MAC_B}`);
    expect(text).toMatch(/add name="ONEDEV0001"[^\n]*profile=netgrid-d1 comment/);
    expect(text).toMatch(/add name="FAMILY0003"[^\n]*profile=netgrid-d3 comment/);
    expect(text).toContain("add name=netgrid-d3 shared-users=3");
    expect(text).not.toContain("RIVALCODE2");
  });

  it("blocks the tenant's blocked devices and nobody else's", async () => {
    h.db.seed("router_devices", [
      { id: "b1", tenant_id: T, router_id: R1, mac: "AA:BB:CC:00:00:09", blocked: true },
      { id: "b2", tenant_id: T, router_id: R1, mac: "AA:BB:CC:00:00:0A", blocked: false },
      { id: "b3", tenant_id: OTHER_T, router_id: R3, mac: "AA:BB:CC:00:00:0B", blocked: true },
    ]);
    const text = await sync(await issueDeviceToken(R1));
    expect(text).toContain("add mac-address=AA:BB:CC:00:00:09 type=blocked");
    expect(text).not.toContain("AA:BB:CC:00:00:0A");
    expect(text).not.toContain("AA:BB:CC:00:00:0B");
  });

  it("installs the anti-tethering rule only while the router's switch is on", async () => {
    const token = await issueDeviceToken(R1);
    expect(await sync(token)).toContain("action=change-ttl new-ttl=set:1");
    h.db.rows("routers").find((r) => r.id === R1)!.block_tethering = false;
    const off = await sync(token);
    expect(off).not.toContain("change-ttl");
    expect(off).toContain("ttl=equal:63"); // detection stays on
  });

  it("points the report script at the device token, never the bootstrap token", async () => {
    const token = await issueDeviceToken(R1);
    const text = await sync(token);
    expect(text).toContain(`https://portal.test/api/public/router/devices/${token}`);
    expect(text).not.toContain("boot".padEnd(32, "x"));
  });
});
