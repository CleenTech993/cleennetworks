import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import { Route as RedeemRoute } from "@/routes/api/public/portal/$slug/voucher";
import { Route as StatusRoute } from "@/routes/api/public/portal/$slug/voucher-status";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER = "99999999-9999-9999-9999-999999999999";
const ROUTER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROUTER_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MAC = "AA:BB:CC:DD:EE:FF";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const future = () => new Date(Date.now() + 3_600_000).toISOString();

const redeem = (body: unknown) => call(RedeemRoute, "POST", { body, ip: freshIp(), params: { slug: "acme" } });
const status = (qs: string, slug = "acme") =>
  call(StatusRoute, "GET", { url: `https://portal.test/x?${qs}`, ip: freshIp(), params: { slug } });

beforeEach(() => {
  h.db = new FakeDb()
    .seed("tenants", [{ id: TENANT, slug: "acme" }, { id: OTHER, slug: "rival" }])
    .seed("packages", [])
    .seed("routers", [
      { id: ROUTER, tenant_id: TENANT, last_sync_at: minutesAgo(1) },
      { id: ROUTER_OTHER, tenant_id: OTHER, last_sync_at: minutesAgo(1) },
    ])
    .seed("vouchers", [
      // used by this device, e.g. the first hotspot login did not go through
      { id: "u1", tenant_id: TENANT, code: "USED2345", status: "used", package_id: null, payment_id: null, expires_at: future(), used_by_mac: MAC, bound_mac: null, created_at: minutesAgo(30) },
      // used by another device
      { id: "u2", tenant_id: TENANT, code: "OTHR2345", status: "used", package_id: null, payment_id: null, expires_at: future(), used_by_mac: "11:22:33:44:55:66", bound_mac: null, created_at: minutesAgo(30) },
      // used by this device but already expired
      { id: "u3", tenant_id: TENANT, code: "OLD22345", status: "used", package_id: null, payment_id: null, expires_at: minutesAgo(5), used_by_mac: MAC, bound_mac: null, created_at: minutesAgo(300) },
      // bought 30 seconds ago, the router synced a minute ago: not on the router yet
      { id: "n1", tenant_id: TENANT, code: "NEWV2345", status: "unused", package_id: null, payment_id: "pay", expires_at: future(), created_at: minutesAgo(0.5) },
      // generated an hour ago: the router has it
      { id: "o1", tenant_id: TENANT, code: "OLDV2345", status: "unused", package_id: null, payment_id: null, expires_at: null, created_at: minutesAgo(60) },
    ]);
});
afterEach(() => vi.restoreAllMocks());

describe("resuming a redeemed voucher", () => {
  it("lets the device that redeemed it enter the code again", async () => {
    const res = await redeem({ code: "USED2345", mac: MAC });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, resumed: true, code: "USED2345" });
  });
  it("matches the MAC regardless of case or separators", async () => {
    expect((await redeem({ code: "USED2345", mac: "aa-bb-cc-dd-ee-ff" })).status).toBe(200);
  });
  it("does not change the voucher when resuming", async () => {
    const before = JSON.stringify(h.db.rows("vouchers").find((v) => v.code === "USED2345"));
    await redeem({ code: "USED2345", mac: MAC });
    expect(JSON.stringify(h.db.rows("vouchers").find((v) => v.code === "USED2345"))).toBe(before);
  });
  it("still refuses a different device, and a request with no device", async () => {
    expect(await json(await redeem({ code: "OTHR2345", mac: MAC }))).toMatchObject({ error: "Voucher already used" });
    expect(await json(await redeem({ code: "USED2345" }))).toMatchObject({ error: "Voucher already used" });
    expect(await json(await redeem({ code: "USED2345", mac: "11:22:33:44:55:66" }))).toMatchObject({ error: "Voucher already used" });
  });
  it("says expired for an expired voucher, even for its owner", async () => {
    expect(await json(await redeem({ code: "OLD22345", mac: MAC }))).toMatchObject({ error: "Voucher expired" });
  });
});

describe("voucher-status (is it on the router yet?)", () => {
  it("is not ready for a voucher newer than the router's last sync", async () => {
    expect(await json(await status(`code=NEWV2345&router=${ROUTER}`))).toMatchObject({ ready: false, known: true });
  });
  it("is ready for a voucher the router already has", async () => {
    expect(await json(await status(`code=OLDV2345&router=${ROUTER}`))).toMatchObject({ ready: true, known: true });
  });
  it("becomes ready after the router syncs again", async () => {
    h.db.rows("routers").find((r) => r.id === ROUTER)!.last_sync_at = minutesAgo(0.3);
    expect(await json(await status(`code=NEWV2345&router=${ROUTER}`))).toMatchObject({ ready: true });
  });
  it("does not block when the router isn't known", async () => {
    expect(await json(await status("code=NEWV2345"))).toMatchObject({ ready: true, known: false });
    expect(await json(await status("code=NEWV2345&router=not-a-uuid"))).toMatchObject({ ready: true, known: false });
    // a router belonging to another tenant is treated as unknown, never consulted
    expect(await json(await status(`code=NEWV2345&router=${ROUTER_OTHER}`))).toMatchObject({ ready: true, known: false });
  });
  it("rejects unknown codes, bad input and unknown portals", async () => {
    expect((await status(`code=NOPE2345&router=${ROUTER}`)).status).toBe(404);
    expect((await status("code=ab")).status).toBe(400);
    expect((await status(`code=OLDV2345&router=${ROUTER}`, "nowhere")).status).toBe(404);
    expect((await status(`code=OLDV2345&router=${ROUTER}`, "rival")).status).toBe(404); // another tenant's portal
  });
});
