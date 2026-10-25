import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { freshIp, h, stubFetch } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({ get supabaseAdmin() { return h.db; } }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => "portal.test" }));

import { Route } from "@/routes/api/public/portal/$slug/checkout";

const TENANT = "11111111-1111-1111-1111-111111111111";
const PKG = "22222222-2222-2222-2222-222222222222";
const PARAMS = { slug: "acme" };
let nextRef = 0;

const payhero = () =>
  stubFetch(() => Response.json({ success: true, CheckoutRequestID: `ws_CO_${++nextRef}`, reference: `ref-${nextRef}` }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
  process.env.PAYHERO_API_USERNAME = "u";
  process.env.PAYHERO_API_PASSWORD = "p";
  process.env.PAYHERO_CHANNEL_ID = "42";
  h.db = new FakeDb()
    .seed("tenants", [{ id: TENANT, slug: "acme", name: "Acme", mpesa_paybill: null, mpesa_till: null }])
    .seed("packages", [
      { id: PKG, tenant_id: TENANT, name: "1 hour", price: 50, kind: "hotspot", active: true },
      { id: "33333333-3333-3333-3333-333333333333", tenant_id: TENANT, name: "old", price: 10, kind: "hotspot", active: false },
      { id: "44444444-4444-4444-4444-444444444444", tenant_id: "99999999-9999-9999-9999-999999999999", name: "other", price: 10, kind: "hotspot", active: true },
    ]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));
const checkout = (body: unknown, ip = freshIp(), params = PARAMS) => call(Route, "POST", { body, ip, params });

describe("checkout", () => {
  it("records a pending payment, sends one STK push and returns the payment id", async () => {
    const fetchSpy = payhero();
    const res = await checkout({ packageId: PKG, phone: "0712 345 678" });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(sent).toMatchObject({ amount: 50, phone_number: "254712345678", channel_id: 42, external_reference: body.paymentId });
    expect(sent.callback_url).toBe(`https://portal.test/api/public/mpesa/callback/${TENANT}`);

    const [pay] = h.db.rows("payments");
    expect(pay).toMatchObject({ id: body.paymentId, tenant_id: TENANT, package_id: PKG, phone: "254712345678", amount: 50, status: "pending" });
    expect(pay.checkout_request_id).toMatch(/^ws_CO_/);
    expect(pay.merchant_request_id).toMatch(/^ref-/);
  });

  it("charges the package price from the database, never an amount the client sends", async () => {
    const fetchSpy = payhero();
    await checkout({ packageId: PKG, phone: "0712345678", amount: 1 });
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).amount).toBe(50);
  });

  it.each([
    ["a non-Kenyan number", "+447911123456"],
    ["a landline-range number", "0212345678"],
    ["too few digits", "0712 345"],
  ])("rejects %s without touching the database or the gateway", async (_l, phone) => {
    const fetchSpy = payhero();
    const res = await checkout({ packageId: PKG, phone });
    expect(res.status).toBe(400);
    expect(h.db.rows("payments")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects inactive packages, other tenants' packages and unknown portals", async () => {
    const fetchSpy = payhero();
    expect((await checkout({ packageId: "33333333-3333-3333-3333-333333333333", phone: "0712345678" })).status).toBe(400);
    expect((await checkout({ packageId: "44444444-4444-4444-4444-444444444444", phone: "0712345678" })).status).toBe(400);
    expect((await checkout({ packageId: PKG, phone: "0712345678" }, freshIp(), { slug: "nope" })).status).toBe(404);
    expect(h.db.rows("payments")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies", async () => {
    expect((await call(Route, "POST", { rawBody: "{nope", ip: freshIp(), params: PARAMS })).status).toBe(400);
    expect((await checkout({ packageId: "not-a-uuid", phone: "0712345678" })).status).toBe(400);
  });

  it("does not leak gateway internals, and marks the payment failed", async () => {
    stubFetch(() => Response.json({ success: false, error_message: "INTERNAL: api key abc123 rejected" }, { status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await checkout({ packageId: PKG, phone: "0712345678" });
    const text = JSON.stringify(await json(res));
    expect(res.status).toBe(502);
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("INTERNAL");
    expect(h.db.rows("payments")[0].status).toBe("failed");
  });

  describe("per-phone abuse limits", () => {
    it("blocks a second prompt within 30s, sends nothing and leaves no junk row", async () => {
      const fetchSpy = payhero();
      expect((await checkout({ packageId: PKG, phone: "0712345678" })).status).toBe(200);
      advance(5_000);
      const res = await checkout({ packageId: PKG, phone: "0712345678" });
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(h.db.rows("payments")).toHaveLength(1);
    });

    it("allows 3 attempts in 10 minutes, then blocks the 4th", async () => {
      const fetchSpy = payhero();
      for (let i = 0; i < 3; i++) {
        expect((await checkout({ packageId: PKG, phone: "0712345678" })).status).toBe(200);
        advance(31_000);
      }
      const res = await checkout({ packageId: PKG, phone: "0712345678" });
      expect(res.status).toBe(429);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(h.db.rows("payments")).toHaveLength(3);
    });

    it("lets the same number back in once the window has passed", async () => {
      payhero();
      for (let i = 0; i < 3; i++) { await checkout({ packageId: PKG, phone: "0712345678" }); advance(31_000); }
      advance(10 * 60_000);
      expect((await checkout({ packageId: PKG, phone: "0712345678" })).status).toBe(200);
    });

    it("counts the same phone across tenants and across different IPs", async () => {
      const fetchSpy = payhero();
      expect((await checkout({ packageId: PKG, phone: "0712345678" }, "7.7.7.7")).status).toBe(200);
      advance(2_000);
      expect((await checkout({ packageId: PKG, phone: "0712345678" }, "8.8.8.8")).status).toBe(429);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("does not throttle different numbers against each other", async () => {
      payhero();
      expect((await checkout({ packageId: PKG, phone: "0712345678" })).status).toBe(200);
      expect((await checkout({ packageId: PKG, phone: "0722345678" })).status).toBe(200);
    });

    it("sends exactly one prompt when a burst of requests hits the same number", async () => {
      const fetchSpy = payhero();
      const ip = freshIp();
      const results = await Promise.all(Array.from({ length: 5 }, () => checkout({ packageId: PKG, phone: "0712345678" }, ip)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 429)).toHaveLength(4);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(h.db.rows("payments")).toHaveLength(1);
    });

    it("fails closed (no prompt sent) if the attempts lookup errors", async () => {
      const fetchSpy = payhero();
      h.db.failNext("payments", "select");
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await checkout({ packageId: PKG, phone: "0712345678" });
      expect(res.status).toBe(429);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("per-IP limit", () => {
    it("allows 6 requests a minute per portal per IP, then answers 429", async () => {
      payhero();
      const ip = freshIp();
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        // distinct numbers so only the IP limiter is in play
        statuses.push((await checkout({ packageId: PKG, phone: `07${10 + i}345678` }, ip)).status);
      }
      expect(statuses.slice(0, 6)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(statuses[6]).toBe(429);
    });
  });
});
