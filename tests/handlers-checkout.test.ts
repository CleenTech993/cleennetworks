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

const TENANT = "11111111-1111-4111-8111-111111111111";
const PKG = "22222222-2222-4222-8222-222222222222";
const COMBO_PKG = "55555555-5555-4555-8555-555555555555";
const PPPOE_PKG = "77777777-7777-4777-8777-777777777777";
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
        id: COMBO_PKG,
        tenant_id: TENANT,
        name: "Phone + TV",
        price: 100,
        kind: "hotspot_tv",
        active: true,
      },
      {
        id: PPPOE_PKG,
        tenant_id: TENANT,
        name: "Home 10 Mbps",
        price: 1500,
        kind: "pppoe",
        active: true,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        tenant_id: TENANT,
        name: "old",
        price: 10,
        kind: "hotspot",
        active: false,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        tenant_id: "99999999-9999-4999-8999-999999999999",
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

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(darajaSpy).toHaveBeenCalledTimes(1);
    expect(darajaSpy).toHaveBeenCalledWith({
      tenantId: TENANT,
      amount: 50,
      phone: "254712345678",
      paymentId: body.paymentId,
      description: "Acme - 1 hour",
      accountReference: "1 hour",
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

  it("queues validated Omada client context for authorization after confirmed payment", async () => {
    const routerId = "66666666-6666-4666-8666-666666666666";
    h.db
      .seed("routers", [{ id: routerId, tenant_id: TENANT, vendor: "tp_link_omada" }])
      .seed("omada_integrations", [
        {
          router_id: routerId,
          tenant_id: TENANT,
          site_name: "Main Site",
          controller_version: "6.2.0",
          enabled: true,
        },
      ]);

    const response = await checkout({
      packageId: PKG,
      phone: "0712345678",
      routerId,
      omadaContext: {
        kind: "eap",
        clientMac: "02:00:00:00:00:02",
        apMac: "02:00:00:00:00:04",
        ssidName: "Guest",
        radioId: "1",
        siteName: "Main Site",
        redirectUrl: "https://example.com/welcome",
      },
    });

    const body = await json(response);

    expect(response.status).toBe(200);
    expect(h.db.rows("omada_authorization_jobs")).toMatchObject([
      {
        payment_id: body.paymentId,
        tenant_id: TENANT,
        router_id: routerId,
        context_kind: "eap",
        client_mac: "02:00:00:00:00:02",
        ap_mac: "02:00:00:00:00:04",
        ssid_name: "Guest",
        radio_id: "1",
        site_name: "Main Site",
        redirect_url: "https://example.com/welcome",
        status: "pending",
      },
    ]);
  });

  it("requires PPPoE customers to sign in to their separate account portal before renewing", async () => {
    const response = await checkout({
      packageId: PPPOE_PKG,
      phone: "0712345678",
    });

    expect(response.status).toBe(400);
    expect(h.db.rows("payments")).toHaveLength(0);
    expect(daraja()).not.toHaveBeenCalled();
  });

  it("rejects an Omada site mismatch before starting payment", async () => {
    const routerId = "66666666-6666-4666-8666-666666666666";
    h.db
      .seed("routers", [{ id: routerId, tenant_id: TENANT, vendor: "tp_link_omada" }])
      .seed("omada_integrations", [
        {
          router_id: routerId,
          tenant_id: TENANT,
          site_name: "Main Site",
          controller_version: "6.2.0",
          enabled: true,
        },
      ]);

    const response = await checkout({
      packageId: PKG,
      phone: "0712345678",
      routerId,
      omadaContext: {
        kind: "eap",
        clientMac: "02:00:00:00:00:02",
        apMac: "02:00:00:00:00:04",
        ssidName: "Guest",
        radioId: "1",
        siteName: "Other Site",
        redirectUrl: null,
      },
    });

    expect(response.status).toBe(400);
    expect(h.db.rows("payments")).toHaveLength(0);
    expect(daraja()).not.toHaveBeenCalled();
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
      (await checkout({ packageId: "33333333-3333-4333-8333-333333333333", phone: "0712345678" }))
        .status,
    ).toBe(400);
    expect(
      (await checkout({ packageId: "44444444-4444-4444-8444-444444444444", phone: "0712345678" }))
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
    expect(text).toContain("contact Acme to verify the PayBill's Daraja setup");
    expect(h.db.rows("payments")[0].status).toBe("failed");
  });

  it("reuses an active prompt for the same phone instead of sending a duplicate", async () => {
    const darajaSpy = daraja();
    const ip = freshIp();
    const first = await checkout({ packageId: PKG, phone: "0712345678" }, ip);
    const firstBody = await json(first);
    advance(1_000);
    const second = await checkout({ packageId: PKG, phone: "0712345678" }, ip);
    const secondBody = await json(second);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody.paymentId).toBe(firstBody.paymentId);
    expect(darajaSpy).toHaveBeenCalledTimes(1);
    expect(h.db.rows("payments")).toHaveLength(1);
  });

  it("expires an old pending prompt and starts a fresh attempt", async () => {
    const darajaSpy = daraja();
    h.db.seed("payments", [
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        tenant_id: TENANT,
        package_id: PKG,
        phone: "254712345678",
        amount: 50,
        status: "pending",
        provider: "daraja",
        created_at: new Date(Date.now() - 11 * 60_000).toISOString(),
      },
    ]);

    const response = await checkout({ packageId: PKG, phone: "0712345678" });

    expect(response.status).toBe(200);
    expect(h.db.rows("payments")[0].status).toBe("failed");
    expect(h.db.rows("payments")).toHaveLength(2);
    expect(darajaSpy).toHaveBeenCalledTimes(1);
  });

  it("requires a usable TV MAC for a phone + TV package", async () => {
    const missingMac = await checkout({ packageId: COMBO_PKG, phone: "0712345678" });
    const invalidMac = await checkout({
      packageId: COMBO_PKG,
      phone: "0712345678",
      tvMac: "01:00:00:00:00:01",
    });

    expect(missingMac.status).toBe(400);
    expect(invalidMac.status).toBe(400);
    expect(h.db.rows("payments")).toHaveLength(0);
    expect(h.db.rows("tv_devices")).toHaveLength(0);
    expect(daraja()).not.toHaveBeenCalled();
  });

  it("registers the TV and attaches it to the same payment", async () => {
    const response = await checkout({
      packageId: COMBO_PKG,
      phone: "0712345678",
      tvMac: "aa-bb-cc-dd-ee-02",
    });
    const body = await json(response);
    const [payment] = h.db.rows("payments");
    const [tv] = h.db.rows("tv_devices");

    expect(response.status).toBe(200);
    expect(tv).toMatchObject({
      tenant_id: TENANT,
      mac_address: "AA:BB:CC:DD:EE:02",
      phone: "254712345678",
      package_id: COMBO_PKG,
      status: "pending",
    });
    expect(payment).toMatchObject({
      id: body.paymentId,
      package_id: COMBO_PKG,
      tv_device_id: tv.id,
      status: "pending",
    });
  });

  it("does not allow a different phone to claim a registered TV", async () => {
    h.db.seed("tv_devices", [
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        tenant_id: TENANT,
        mac_address: "AA:BB:CC:DD:EE:02",
        phone: "254700000000",
        status: "expired",
      },
    ]);

    const response = await checkout({
      packageId: COMBO_PKG,
      phone: "0712345678",
      tvMac: "AA:BB:CC:DD:EE:02",
    });

    expect(response.status).toBe(403);
    expect(h.db.rows("payments")).toHaveLength(0);
    expect(daraja()).not.toHaveBeenCalled();
  });

  it("keeps an existing TV plan unchanged until the combined payment succeeds", async () => {
    const expiresAt = "2026-10-25T12:00:00.000Z";
    h.db.seed("tv_devices", [
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        tenant_id: TENANT,
        mac_address: "AA:BB:CC:DD:EE:02",
        phone: "254712345678",
        package_id: PKG,
        status: "active",
        expires_at: expiresAt,
      },
    ]);

    const response = await checkout({
      packageId: COMBO_PKG,
      phone: "0712345678",
      tvMac: "AA:BB:CC:DD:EE:02",
    });

    expect(response.status).toBe(200);
    expect(h.db.rows("tv_devices")[0]).toMatchObject({
      package_id: PKG,
      status: "active",
      expires_at: expiresAt,
    });
  });
});
