import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { freshIp, h, stubFetch } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => "portal.test" }));

import { Route } from "@/routes/api/public/portal/$slug/tv";

const TENANT = "11111111-1111-1111-1111-111111111111";
const PKG = "22222222-2222-2222-2222-222222222222";
const NO_DURATION_PKG = "33333333-3333-3333-3333-333333333333";
const INACTIVE_PKG = "44444444-4444-4444-4444-444444444444";
const OTHER_TENANT_PKG = "55555555-5555-5555-5555-555555555555";
const PARAMS = { slug: "acme" };
const MAC = "AA:BB:CC:DD:EE:FF";
let nextRef = 0;

const payhero = () =>
  stubFetch(() =>
    Response.json({
      success: true,
      CheckoutRequestID: `ws_CO_${++nextRef}`,
      reference: `ref-${nextRef}`,
    }),
  );

beforeEach(() => {
  process.env.PAYHERO_API_USERNAME = "u";
  process.env.PAYHERO_API_PASSWORD = "p";
  process.env.PAYHERO_CHANNEL_ID = "42";
  h.db = new FakeDb()
    .seed("tenants", [
      { id: TENANT, slug: "acme", name: "Acme", mpesa_paybill: null, mpesa_till: null },
    ])
    .seed("packages", [
      {
        id: PKG,
        tenant_id: TENANT,
        name: "3 hours",
        price: 30,
        kind: "hotspot",
        active: true,
        duration_value: 3,
        duration_unit: "hours",
      },
      {
        id: NO_DURATION_PKG,
        tenant_id: TENANT,
        name: "x",
        price: 5,
        kind: "hotspot",
        active: true,
        duration_value: null,
        duration_unit: null,
      },
      {
        id: INACTIVE_PKG,
        tenant_id: TENANT,
        name: "old",
        price: 5,
        kind: "hotspot",
        active: false,
        duration_value: 1,
        duration_unit: "hours",
      },
      {
        id: OTHER_TENANT_PKG,
        tenant_id: "99999999-9999-9999-9999-999999999999",
        name: "other",
        price: 5,
        kind: "hotspot",
        active: true,
        duration_value: 1,
        duration_unit: "hours",
      },
    ]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const register = (body: unknown, ip = freshIp()) =>
  call(Route, "POST", { body, ip, params: PARAMS });
const valid = (extra: Record<string, unknown> = {}) => ({
  mac: MAC,
  packageId: PKG,
  phone: "0712345678",
  ...extra,
});

describe("smart TV registration", () => {
  it("registers a new TV, records a payment tied to it and sends one STK push", async () => {
    const fetchSpy = payhero();
    const res = await register(valid({ mac: "aa-bb-cc-dd-ee-ff", name: "Living room" }));
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.mac).toBe(MAC);
    const tvs = h.db.rows("tv_devices");
    expect(tvs).toHaveLength(1);
    expect(tvs[0]).toMatchObject({
      tenant_id: TENANT,
      mac_address: MAC,
      name: "Living room",
      status: "pending",
      package_id: PKG,
    });
    const pays = h.db.rows("payments");
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({
      tenant_id: TENANT,
      package_id: PKG,
      amount: 30,
      status: "pending",
      tv_device_id: tvs[0].id,
    });
    expect(body.paymentId).toBe(pays[0].id);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("charges the price from the database, never one the client sends", async () => {
    payhero();
    await register(valid({ amount: 1, price: 1 }));
    expect(h.db.rows("payments")[0].amount).toBe(30);
  });

  it("renewing a TV that is still paid up does not switch it off", async () => {
    payhero();
    const until = "2026-12-01T00:00:00.000Z";
    h.db.seed("tv_devices", [
      {
        id: "tv-1",
        tenant_id: TENANT,
        mac_address: MAC,
        status: "active",
        expires_at: until,
        package_id: PKG,
      },
    ]);
    const res = await register(valid());
    expect(res.status).toBe(200);
    const tvs = h.db.rows("tv_devices");
    expect(tvs).toHaveLength(1);
    expect(tvs[0]).toMatchObject({ status: "active", expires_at: until });
    expect(h.db.rows("payments")[0].tv_device_id).toBe("tv-1");
  });

  it("refuses a blocked TV and sends nothing", async () => {
    const fetchSpy = payhero();
    h.db.seed("tv_devices", [
      { id: "tv-1", tenant_id: TENANT, mac_address: MAC, status: "blocked" },
    ]);
    const res = await register(valid());
    expect(res.status).toBe(403);
    expect(h.db.rows("payments")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["too short", "AA:BB:CC"],
    ["not hex", "ZZ:BB:CC:DD:EE:FF"],
    ["multicast", "01:00:5E:00:00:01"],
    ["broadcast", "FF:FF:FF:FF:FF:FF"],
    ["a script injection attempt", 'AA:BB:CC:DD:EE:FF"; /system reset-configuration'],
  ])(
    "rejects an invalid MAC (%s) without touching the database or the gateway",
    async (_label, mac) => {
      const fetchSpy = payhero();
      const res = await register(valid({ mac }));
      expect(res.status).toBe(400);
      expect(h.db.rows("tv_devices")).toHaveLength(0);
      expect(h.db.rows("payments")).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("rejects inactive, other-tenant and duration-less packages", async () => {
    const fetchSpy = payhero();
    for (const packageId of [INACTIVE_PKG, OTHER_TENANT_PKG, NO_DURATION_PKG]) {
      expect((await register(valid({ packageId }))).status).toBe(400);
    }
    expect(h.db.rows("tv_devices")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown portal", async () => {
    payhero();
    expect(
      (await call(Route, "POST", { body: valid(), ip: freshIp(), params: { slug: "nope" } }))
        .status,
    ).toBe(404);
  });

  it("does not leak gateway internals, and marks the payment failed", async () => {
    stubFetch(
      () => new Response("secret-gateway-detail https://internal.example/acct/42", { status: 500 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await register(valid());
    const text = JSON.stringify(await json(res));
    expect(res.status).toBe(502);
    expect(text).not.toContain("secret-gateway-detail");
    expect(text).not.toContain("internal.example");
    expect(h.db.rows("payments")[0].status).toBe("failed");
  });

  it("allows 5 registrations a minute per IP, then answers 429", async () => {
    payhero();
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await register(valid({ mac: `AA:BB:CC:DD:EE:${(i + 16).toString(16)}` }), ip)).status,
      );
    }
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("smart TV status", () => {
  const status = (mac: string, ip = freshIp()) =>
    call(Route, "GET", {
      url: `https://portal.test/api/public/portal/acme/tv?mac=${encodeURIComponent(mac)}`,
      ip,
      params: PARAMS,
    });

  it("reports an active TV with its expiry", async () => {
    h.db.seed("tv_devices", [
      {
        id: "tv-1",
        tenant_id: TENANT,
        mac_address: MAC,
        status: "active",
        expires_at: "2999-01-01T00:00:00.000Z",
      },
    ]);
    const body = await json(await status(MAC));
    expect(body).toMatchObject({
      registered: true,
      active: true,
      expires_at: "2999-01-01T00:00:00.000Z",
    });
  });

  it("does not report an expired TV as active", async () => {
    h.db.seed("tv_devices", [
      {
        id: "tv-1",
        tenant_id: TENANT,
        mac_address: MAC,
        status: "active",
        expires_at: "2000-01-01T00:00:00.000Z",
      },
    ]);
    expect(await json(await status(MAC))).toMatchObject({
      registered: true,
      active: false,
      expires_at: null,
    });
  });

  it("reports an unknown TV as not registered, and rejects a malformed MAC", async () => {
    expect(await json(await status(MAC))).toMatchObject({ registered: false, active: false });
    expect((await status("nope")).status).toBe(400);
  });

  it("only looks within the portal's own tenant", async () => {
    h.db.seed("tv_devices", [
      {
        id: "tv-x",
        tenant_id: "99999999-9999-9999-9999-999999999999",
        mac_address: MAC,
        status: "active",
        expires_at: "2999-01-01T00:00:00.000Z",
      },
    ]);
    expect(await json(await status(MAC))).toMatchObject({ registered: false, active: false });
  });
});
