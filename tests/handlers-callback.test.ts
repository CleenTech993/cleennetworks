import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { h, stubFetch } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({ get supabaseAdmin() { return h.db; } }));

import { Route } from "@/routes/api/public/mpesa/callback.$tenantId";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "99999999-9999-9999-9999-999999999999";
const PAY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const HOTSPOT_PKG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PPPOE_PKG = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const callbackBody = (extra: Record<string, unknown> = {}) => ({
  response: { ExternalReference: PAY, CheckoutRequestID: "ws_CO_1", MpesaReceiptNumber: "FORGED123", Amount: 1, ...extra },
});
const send = (body: unknown = callbackBody(), tenantId = TENANT) => call(Route, "POST", { body, params: { tenantId } });
const payheroSays = (status: string, receipt: string | null = "QKT1234567") =>
  stubFetch(() => Response.json({ status, provider_reference: receipt }));

beforeEach(() => {
  process.env.PAYHERO_API_USERNAME = "u";
  process.env.PAYHERO_API_PASSWORD = "p";
  h.db = new FakeDb()
    .seed("packages", [
      { id: HOTSPOT_PKG, tenant_id: TENANT, kind: "hotspot", duration_value: 2, duration_unit: "hours" },
      { id: PPPOE_PKG, tenant_id: TENANT, kind: "pppoe", duration_value: 1, duration_unit: "months" },
    ])
    .seed("payments", [
      { id: PAY, tenant_id: TENANT, package_id: HOTSPOT_PKG, phone: "254712345678", amount: 50, status: "pending", checkout_request_id: "ws_CO_1", merchant_request_id: "ref-1" },
    ]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const payment = () => h.db.rows("payments").find((p) => p.id === PAY)!;

describe("mpesa callback", () => {
  it("on a verified SUCCESS: marks the payment paid and issues exactly one voucher", async () => {
    payheroSays("SUCCESS");
    const res = await send();
    expect(res.status).toBe(200);

    const vouchers = h.db.rows("vouchers");
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]).toMatchObject({ tenant_id: TENANT, package_id: HOTSPOT_PKG, payment_id: PAY });
    expect(vouchers[0].code).toMatch(/^[A-Z2-9]{10}$/);

    expect(payment()).toMatchObject({ status: "success", mpesa_receipt: "QKT1234567", voucher_code: vouchers[0].code });
    const hours = (new Date(String(payment().expires_at)).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThan(2.1);
  });

  it("trusts PayHero's receipt and the stored amount, never the callback body's", async () => {
    payheroSays("SUCCESS", "REALRECEIPT");
    await send(callbackBody({ MpesaReceiptNumber: "FORGED123", Amount: 1 }));
    expect(payment().mpesa_receipt).toBe("REALRECEIPT");
    expect(payment().amount).toBe(50);
  });

  it("does NOT pay out when the body claims success but PayHero says it is still queued", async () => {
    payheroSays("QUEUED");
    const res = await send(callbackBody({ ResultCode: 0, ResultDesc: "success" }));
    expect(await json(res)).toMatchObject({ ok: true, note: "Pending" });
    expect(payment().status).toBe("pending");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("records a verified failure and issues nothing", async () => {
    payheroSays("FAILED");
    await send();
    expect(payment().status).toBe("failed");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("does not verify or pay a payment that has no gateway reference yet", async () => {
    const fetchSpy = payheroSays("SUCCESS");
    payment().merchant_request_id = null;
    const res = await send();
    expect(await json(res)).toMatchObject({ note: "Pending" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("is idempotent: a replayed callback issues no second voucher", async () => {
    payheroSays("SUCCESS");
    await send();
    const res = await send();
    expect(await json(res)).toMatchObject({ note: "Already processed" });
    expect(h.db.rows("vouchers")).toHaveLength(1);
  });

  it("issues exactly one voucher when duplicate callbacks arrive at the same time", async () => {
    payheroSays("SUCCESS");
    const results = await Promise.all([send(), send(), send(), send()]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(h.db.rows("vouchers")).toHaveLength(1);
    expect(payment().status).toBe("success");
  });

  it("a failed payment can still be completed by a later successful callback", async () => {
    payment().status = "failed";
    payheroSays("SUCCESS");
    await send();
    expect(payment().status).toBe("success");
    expect(h.db.rows("vouchers")).toHaveLength(1);
  });

  it("ignores a callback addressed to the wrong tenant", async () => {
    const fetchSpy = payheroSays("SUCCESS");
    const res = await send(callbackBody(), OTHER_TENANT);
    expect(await json(res)).toMatchObject({ note: "Unknown payment" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payment().status).toBe("pending");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("finds the payment by checkout id when the external reference is not our uuid", async () => {
    payheroSays("SUCCESS");
    await send({ response: { ExternalReference: "garbage", CheckoutRequestID: "ws_CO_1" } });
    expect(payment().status).toBe("success");
  });

  it("acknowledges bodies with no reference, and rejects invalid JSON", async () => {
    expect((await send({ response: {} })).status).toBe(200);
    expect((await call(Route, "POST", { rawBody: "{bad", params: { tenantId: TENANT } })).status).toBe(400);
  });

  it("returns 502 and leaves the payment pending when verification is unreachable (so PayHero retries)", async () => {
    stubFetch(() => new Response("upstream down", { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await send();
    expect(res.status).toBe(502);
    expect(payment().status).toBe("pending");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("releases the claim if voucher creation fails, so a retry can finish the job", async () => {
    payheroSays("SUCCESS");
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.db.failNext("vouchers", "insert", "disk full");
    const res = await send();
    expect(res.status).toBe(500);
    expect(payment().status).toBe("pending");

    expect((await send()).status).toBe(200);
    expect(payment().status).toBe("success");
    expect(h.db.rows("vouchers")).toHaveLength(1);
  });

  it("sets an expiry but issues no voucher for non-hotspot packages", async () => {
    payment().package_id = PPPOE_PKG;
    payheroSays("SUCCESS");
    await send();
    expect(h.db.rows("vouchers")).toHaveLength(0);
    expect(payment()).toMatchObject({ status: "success", voucher_code: null });
    expect(payment().expires_at).toBeTruthy();
  });
});
