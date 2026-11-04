import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

const darajaMock = vi.hoisted(() => ({
  start: vi.fn(async () => ({ checkoutRequestId: "", merchantRequestId: "" })),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@/lib/daraja.server", () => ({ startDarajaStkPush: darajaMock.start }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => "portal.test" }));

import { Route } from "@/routes/api/public/portal/$slug/checkout";
import { startDarajaStkPush } from "@/lib/daraja.server";

const TENANT = "11111111-1111-1111-1111-111111111111";
const PKG = "22222222-2222-2222-2222-222222222222";
const PARAMS = { slug: "acme" };
let nextRef = 0;

const daraja = () => vi.mocked(startDarajaStkPush);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
  nextRef = 0;
  darajaMock.start.mockReset().mockImplementation(async () => {
    const ref = ++nextRef;
    return { checkoutRequestId: `ws_CO_${ref}`, merchantRequestId: `merchant-${ref}` };
  });
  h.db = new FakeDb()
    .seed("tenants", [
      { id: TENANT, slug: "acme", name: "Acme", mpesa_paybill: null, mpesa_till: null },
    ])
    .seed("packages", [
      { id: PKG, tenant_id: TENANT, name: "1 hour", price: 50, kind: "hotspot", active: true },
      {
        id: "33333333-3333-3333-3333-333333333333",
        tenant_id: TENANT,
        name: "old",
        price: 10,
        kind: "hotspot",
        active: false,
      },
      {
        id: "44444444-4444-4444-4444-444444444444",
        tenant_id: "99999999-9999-9999-9999-999999999999",
        name: "other",
        price: 10,
        kind: "hotspot",
        active: true,
      },
    ]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));
const checkout = (body: unknown, ip = freshIp(), params = PARAMS) =>
  call(Route, "POST", { body, ip, params });

describe("checkout", () => {
  it("records a pending payment, sends one STK push and returns the payment id", async () => {
    const darajaSpy = daraja();
    const res = await checkout({ packageId: PKG, phone: "0712 345 678" });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(darajaSpy).toHaveBeenCalledTimes(1);
    expect(darajaSpy).toHaveBeenCalledWith({
      tenantId: TENANT,
      amount: 50,
      phone: "254712345678",
      paymentId: body.paymentId,
      description: "hotspot",
      callbackUrl: `https://portal.test/api/public/mpesa/callback/${TENANT}`,
    });

    const [pay] = h.db.rows("payments");
    expect(pay).toMatchObject({
      id: body.paymentId,
      tenant_id: TENANT,
      package_id: PKG,
      phone: "254712345678",
      amount: 50,
      status: "pending",
    });
    expect(pay.provider).toBe("daraja");
    expect(pay.checkout_request_id).toBe("ws_CO_1");
    expect(pay.merchant_request_id).toBe("merchant-1");
  });

  it("charges the package price from the database, never an amount the client sends", async () => {
    const darajaSpy = daraja();
    await checkout({ packageId: PKG, phone: "0712345678", amount: 1 });
    expect(darajaSpy).toHaveBeenCalledWith(expect.objectContaining({ amount: 50 }));
  });

  it.each([
    ["a non-Kenyan number", "+447911123456"],
    ["a landline-range number", "0212345678"],
    ["too few digits", "0712 345"],
  ])("rejects %s without touching the database or the gateway", async (_l, phone) => {
    const darajaSpy = daraja();
    const res = await checkout({ packageId: PKG, phone });
    expect(res.status).toBe(400);
    expect(h.db.rows("payments")).toHaveLength(0);
    expect(darajaSpy).not.toHaveBeenCalled();
  });

  it("rejects inactive packages, other tenants' packages and unknown portals", async () => {
    const darajaSpy = daraja();
    expect(
      (await checkout({ packageId: "33333333-3333-3333-3333-333333333333", phone: "0712345678" }))
        .status,
    ).toBe(400);
    expect(
      (await checkout({ packageId: "44444444-4444-4444-4444-444444444444", phone: "0712345678" }))
        .status,
    ).toBe(400);
    expect(
      (await checkout({ packageId: PKG, phone: "0712345678" }, freshIp(), { slug: "nope" })).status,
    ).toBe(404);
    expect(h.db.rows("payments")).toHaveLength(0);
    expect(darajaSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies", async () => {
    expect(
      (await call(Route, "POST", { rawBody: "{nope", ip: freshIp(), params: PARAMS })).status,
    ).toBe(400);
    expect((await checkout({ packageId: "not-a-uuid", phone: "0712345678" })).status).toBe(400);
  });

  it("does not leak gateway internals, and marks the payment failed", async () => {
    darajaMock.start.mockRejectedValueOnce(new Error("INTERNAL: api key abc123 rejected"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await checkout({ packageId: PKG, phone: "0712345678" });
    const text = JSON.stringify(await json(res));
    expect(res.status).toBe(502);
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("INTERNAL");
    expect(h.db.rows("payments")[0].status).toBe("failed");
  });

  it("allows repeated prompts for the same phone without an application attempt cap", async () => {
    const darajaSpy = daraja();
    const ip = freshIp();
    const responses = [];
    for (let i = 0; i < 8; i++) {
      responses.push(await checkout({ packageId: PKG, phone: "0712345678" }, ip));
      advance(1_000);
    }

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(darajaSpy).toHaveBeenCalledTimes(8);
    expect(h.db.rows("payments")).toHaveLength(8);
  });
});
