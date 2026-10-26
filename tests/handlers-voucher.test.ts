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

  it("refuses used, expired and unknown codes with distinct errors", async () => {
    expect(await json(await redeem({ code: "USED2345" }))).toMatchObject({
      error: "Voucher already used",
    });
    expect(await json(await redeem({ code: "OLD22345" }))).toMatchObject({
      error: "Voucher expired",
    });
    const missing = await redeem({ code: "NOPE2345" });
    expect(missing.status).toBe(404);
    expect(voucher("USED2345").status).toBe("used");
    expect(voucher("OLD22345").status).toBe("unused");
  });

  it("cannot redeem another tenant's voucher through this portal", async () => {
    const res = await redeem({ code: "RIVAL234" });
    expect(res.status).toBe(404);
    expect(voucher("RIVAL234").status).toBe("unused");
    expect((await redeem({ code: "RIVAL234" }, freshIp(), "rival")).status).toBe(200);
  });

  it("lets exactly one of several simultaneous redemptions win", async () => {
    const ip = freshIp();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => redeem({ code: "ABCD2345", mac: `mac-${i}` }, ip)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);
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

  it("a genuinely used voucher is still reported as already used", async () => {
    expect((await redeem({ code: "ABCD2345" })).status).toBe(200);
    const again = await redeem({ code: "ABCD2345" });
    expect(again.status).toBe(400);
    expect((await json(again)).error).toMatch(/already used/i);
  });
});
