import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import { Route } from "@/routes/api/public/portal/$slug/voucher";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER = "99999999-9999-9999-9999-999999999999";
const PKG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const hoursFromNow = (iso: unknown) => (new Date(String(iso)).getTime() - Date.now()) / 3_600_000;

const redeem = (body: unknown, ip = freshIp(), slug = "acme") =>
  call(Route, "POST", { body, ip, params: { slug } });
const voucher = (code: string) => h.db.rows("vouchers").find((v) => v.code === code)!;

beforeEach(() => {
  h.db = new FakeDb()
    .seed("tenants", [
      { id: TENANT, slug: "acme" },
      { id: OTHER, slug: "rival" },
    ])
    .seed("packages", [{ id: PKG, tenant_id: TENANT, duration_value: 3, duration_unit: "hours" }])
    .seed("vouchers", [
      {
        id: "v1",
        tenant_id: TENANT,
        code: "ABCD2345",
        status: "unused",
        package_id: PKG,
        payment_id: null,
        expires_at: null,
      },
      {
        id: "v2",
        tenant_id: TENANT,
        code: "USED2345",
        status: "used",
        package_id: PKG,
        payment_id: null,
        expires_at: null,
      },
      {
        id: "v3",
        tenant_id: TENANT,
        code: "OLD22345",
        status: "unused",
        package_id: PKG,
        payment_id: null,
        expires_at: "2020-01-01T00:00:00Z",
      },
      {
        id: "v4",
        tenant_id: TENANT,
        code: "PAID2345",
        status: "unused",
        package_id: PKG,
        payment_id: "pay-1",
        expires_at: new Date(Date.now() + 5 * 3_600_000).toISOString(),
      },
      {
        id: "v5",
        tenant_id: OTHER,
        code: "RIVAL234",
        status: "unused",
        package_id: null,
        payment_id: null,
        expires_at: null,
      },
    ]);
});
afterEach(() => vi.restoreAllMocks());

describe("voucher redemption", () => {
  it("redeems an admin-issued voucher and starts the usage clock now", async () => {
    const res = await redeem({ code: "ABCD2345", mac: "AA:BB:CC:DD:EE:FF" });
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, packageId: PKG, code: "ABCD2345" });
    expect(hoursFromNow(body.expiresAt)).toBeGreaterThan(2.9);
    expect(hoursFromNow(body.expiresAt)).toBeLessThan(3.1);
    expect(voucher("ABCD2345")).toMatchObject({ status: "used", used_by_mac: "AA:BB:CC:DD:EE:FF" });
  });

  it("keeps the expiry a purchased voucher already earned", async () => {
    const before = String(voucher("PAID2345").expires_at);
    const body = await json(await redeem({ code: "PAID2345" }));
    expect(body.expiresAt).toBe(before);
  });

  it("accepts lower-case input with stray whitespace", async () => {
    expect((await redeem({ code: "  abcd2345 " })).status).toBe(200);
  });

  it("refuses expired and unknown codes with distinct errors", async () => {
    expect(await json(await redeem({ code: "OLD22345" }))).toMatchObject({
      error: "Voucher expired",
    });
    const missing = await redeem({ code: "NOPE2345" });
    expect(missing.status).toBe(404);
    expect(voucher("OLD22345").status).toBe("unused");
  });

  it("lets an already-used code log in again instead of stranding the customer", async () => {
    // The router only learns a new voucher at its next sync, so the first login can fail. The
    // customer must be able to come back with the same code.
    const res = await redeem({ code: "USED2345" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, reconnect: true, code: "USED2345" });
    expect(voucher("USED2345").status).toBe("used");
  });
  it("cannot redeem another tenant's voucher through this portal", async () => {
    const res = await redeem({ code: "RIVAL234" });
    expect(res.status).toBe(404);
    expect(voucher("RIVAL234").status).toBe("unused");
    expect((await redeem({ code: "RIVAL234" }, freshIp(), "rival")).status).toBe(200);
  });

  it("a burst of simultaneous taps redeems once; the rest simply reconnect", async () => {
    const ip = freshIp();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => redeem({ code: "ABCD2345", mac: `mac-${i}` }, ip)),
    );
    const bodies = await Promise.all(results.map((r) => json(r)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(bodies.filter((b) => !b.reconnect)).toHaveLength(1); // exactly one real redemption
    expect(bodies.filter((b) => b.reconnect)).toHaveLength(5); // nobody is told "already used"
    expect(voucher("ABCD2345").status).toBe("used");
  });

  it("rejects bad input and unknown portals", async () => {
    expect(
      (await call(Route, "POST", { rawBody: "nope", ip: freshIp(), params: { slug: "acme" } }))
        .status,
    ).toBe(400);
    expect((await redeem({ code: "ab" })).status).toBe(400);
    expect((await redeem({ code: "ABCD2345" }, freshIp(), "ghost")).status).toBe(404);
  });

  it("throttles code guessing: 10 tries a minute per IP, then 429 even for a valid code", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) await redeem({ code: `WRONG${1000 + i}` }, ip);
    const res = await redeem({ code: "ABCD2345" }, ip);
    expect(res.status).toBe(429);
    expect(voucher("ABCD2345").status).toBe("unused");
  });
});

describe("when the database misbehaves", () => {
  const MAC = "AA:BB:CC:DD:EE:02";

  it("reports a database error as an error, never as 'already used'", async () => {
    h.db.failNext("vouchers", "update", "connection reset");
    const res = await redeem({ code: "ABCD2345" });
    expect(res.status).toBe(500);
    expect((await json(res)).error).not.toMatch(/already used/i);
    expect(voucher("ABCD2345").status).toBe("unused"); // nothing was consumed, the customer can retry
  });

  it("still redeems when the bound_mac column has not been migrated yet", async () => {
    h.db.failNext(
      "vouchers",
      "update",
      "Could not find the 'bound_mac' column of 'vouchers' in the schema cache",
    );
    const res = await redeem({ code: "ABCD2345", mac: MAC });
    expect(res.status).toBe(200);
    expect(voucher("ABCD2345").status).toBe("used");
    expect(voucher("ABCD2345").bound_mac).toBeUndefined(); // could not pin, but the customer is not locked out
  });

  it("a second redeem of the same code reconnects without changing the voucher", async () => {
    expect((await redeem({ code: "ABCD2345", mac: "AA:BB:CC:DD:EE:02" })).status).toBe(200);
    const first = { ...voucher("ABCD2345") };
    const again = await redeem({ code: "ABCD2345", mac: "AA:BB:CC:DD:EE:02" });
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ ok: true, reconnect: true });
    const after = voucher("ABCD2345");
    expect(after.used_at).toBe(first.used_at);
    expect(after.used_by_mac).toBe(first.used_by_mac);
    expect(after.expires_at).toBe(first.expires_at);
  });
});

describe("logging in again with a used voucher", () => {
  const MAC_A = "AA:BB:CC:DD:EE:0A";
  const MAC_B = "AA:BB:CC:DD:EE:0B";

  it("the device that redeemed it can come back, another device on a one-device plan cannot", async () => {
    expect((await redeem({ code: "ABCD2345", mac: MAC_A })).status).toBe(200);
    expect(voucher("ABCD2345").bound_mac).toBe(MAC_A);

    expect((await redeem({ code: "ABCD2345", mac: MAC_A })).status).toBe(200);
    const other = await redeem({ code: "ABCD2345", mac: MAC_B });
    expect(other.status).toBe(400);
    expect((await json(other)).error).toMatch(/another device/i);
  });

  it("an expired used voucher is refused", async () => {
    voucher("USED2345").expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await redeem({ code: "USED2345" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/expired/i);
  });

  it("a revoked voucher is still refused", async () => {
    voucher("USED2345").status = "revoked";
    expect((await redeem({ code: "USED2345" })).status).toBe(400);
  });

  it("another device may use a code on a multi-device plan", async () => {
    h.db.rows("packages")[0].device_limit = 3;
    expect((await redeem({ code: "ABCD2345", mac: MAC_A })).status).toBe(200);
    expect(voucher("ABCD2345").bound_mac).toBeUndefined(); // not pinned: more than one device allowed
    expect((await redeem({ code: "ABCD2345", mac: MAC_B })).status).toBe(200);
  });

  it("never reaches across tenants", async () => {
    voucher("RIVAL234").status = "used";
    expect((await redeem({ code: "RIVAL234" })).status).toBe(404);
  });
});

describe("waiting for the router to receive a new voucher", () => {
  const ROUTER = "11111111-aaaa-bbbb-cccc-000000000001";
  const FOREIGN = "22222222-aaaa-bbbb-cccc-000000000002";
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  beforeEach(() => {
    h.db.seed("routers", [
      { id: ROUTER, tenant_id: TENANT, name: "Tower", last_sync_at: ago(60_000) },
      { id: FOREIGN, tenant_id: OTHER, name: "Rival", last_sync_at: null },
    ]);
  });

  it("is ready when the router synced after the voucher was created", async () => {
    voucher("ABCD2345").created_at = ago(10 * 60_000);
    const body = await json(await redeem({ code: "ABCD2345", router: ROUTER }));
    expect(body.routerReady).toBe(true);
  });

  it("is NOT ready while the voucher is newer than the router's last sync", async () => {
    voucher("ABCD2345").created_at = ago(10_000); // created 10 s ago, after the router's sync 60 s ago
    const body = await json(await redeem({ code: "ABCD2345", router: ROUTER }));
    expect(body.routerReady).toBe(false);
  });

  it("is not ready if the router has never synced", async () => {
    h.db.rows("routers").find((r) => r.id === ROUTER)!.last_sync_at = null;
    voucher("ABCD2345").created_at = ago(10 * 60_000);
    expect((await json(await redeem({ code: "ABCD2345", router: ROUTER }))).routerReady).toBe(
      false,
    );
  });

  it("also reports readiness when a used code logs in again", async () => {
    voucher("USED2345").created_at = ago(10_000);
    const body = await json(await redeem({ code: "USED2345", router: ROUTER }));
    expect(body).toMatchObject({ reconnect: true, routerReady: false });
  });

  it("never blocks the customer on information it does not have", async () => {
    voucher("ABCD2345").created_at = ago(10_000);
    // no router given, a made-up id, malformed id, and another tenant's router: all just 'ready'
    for (const router of [
      undefined,
      "33333333-aaaa-bbbb-cccc-000000000003",
      "not-a-uuid",
      FOREIGN,
    ]) {
      h.db.rows("vouchers").find((v) => v.code === "ABCD2345")!.status = "unused";
      const body = await json(await redeem({ code: "ABCD2345", router }));
      expect(body.routerReady, String(router)).toBe(true);
    }
  });

  it("still says ready if the router table has no last_sync_at yet (migration not applied)", async () => {
    voucher("ABCD2345").created_at = ago(10_000);
    h.db.failNext("routers", "select", "column routers.last_sync_at does not exist");
    expect((await json(await redeem({ code: "ABCD2345", router: ROUTER }))).routerReady).toBe(true);
  });
});
