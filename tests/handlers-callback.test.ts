import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
import { Route } from "@/routes/api/public/mpesa/callback.$tenantId";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "99999999-9999-9999-9999-999999999999";
const PAY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const HOTSPOT_PKG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PPPOE_PKG = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const callbackBody = (options: { resultCode?: number; amount?: number; phone?: number } = {}) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: "merchant-daraja",
      CheckoutRequestID: "ws_CO_1",
      ResultCode: options.resultCode ?? 0,
      CallbackMetadata: {
        Item: [
          { Name: "Amount", Value: options.amount ?? 50 },
          { Name: "MpesaReceiptNumber", Value: "DAR1234567" },
          { Name: "PhoneNumber", Value: options.phone ?? 254712345678 },
        ],
      },
    },
  },
});
const send = (body: unknown = callbackBody(), tenantId = TENANT) =>
  call(Route, "POST", { body, params: { tenantId } });

beforeEach(() => {
  h.db = new FakeDb()
    .seed("packages", [
      {
        id: HOTSPOT_PKG,
        tenant_id: TENANT,
        kind: "hotspot",
        duration_value: 2,
        duration_unit: "hours",
      },
      {
        id: PPPOE_PKG,
        tenant_id: TENANT,
        kind: "pppoe",
        duration_value: 1,
        duration_unit: "months",
      },
    ])
    .seed("payments", [
      {
        id: PAY,
        tenant_id: TENANT,
        package_id: HOTSPOT_PKG,
        phone: "254712345678",
        amount: 50,
        status: "pending",
        provider: "daraja",
        checkout_request_id: "ws_CO_1",
        merchant_request_id: "merchant-daraja",
        tv_device_id: null,
        expires_at: null,
      },
    ]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const payment = () => h.db.rows("payments").find((row) => row.id === PAY)!;

describe("tenant Daraja callback", () => {
  it("settles a successful Daraja callback and issues a voucher", async () => {
    const response = await send();
    expect(response.status).toBe(200);

    const vouchers = h.db.rows("vouchers");
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]).toMatchObject({
      tenant_id: TENANT,
      package_id: HOTSPOT_PKG,
      payment_id: PAY,
    });
    expect(vouchers[0].code).toMatch(/^[A-Z2-9]{10}$/);
    expect(payment()).toMatchObject({
      status: "success",
      mpesa_receipt: "DAR1234567",
      voucher_code: vouchers[0].code,
    });
    const hours = (new Date(String(payment().expires_at)).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThan(2.1);
  });

  it("records M-Pesa failure and issues nothing", async () => {
    await send(callbackBody({ resultCode: 1032 }));
    expect(payment().status).toBe("failed");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("does not settle callback details that do not match the stored amount or phone", async () => {
    await send(callbackBody({ amount: 1 }));
    expect(payment().status).toBe("pending");

    await send(callbackBody({ phone: 254700000000 }));
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("ignores callbacks for another tenant and non-Daraja callback formats", async () => {
    const wrongTenant = await send(callbackBody(), OTHER_TENANT);
    expect(wrongTenant.status).toBe(503);
    const oldGateway = await send({ response: { CheckoutRequestID: "ws_CO_1" } });
    expect(await json(oldGateway)).toMatchObject({ note: "Unknown callback" });
    expect(payment().status).toBe("pending");
  });

  it("acknowledges missing references and rejects invalid JSON", async () => {
    expect((await send({ Body: { stkCallback: {} } })).status).toBe(200);
    expect(
      (
        await call(Route, "POST", {
          rawBody: "{bad",
          params: { tenantId: TENANT },
        })
      ).status,
    ).toBe(400);
  });

  it("is idempotent when a callback is replayed", async () => {
    await send();
    const response = await send();
    expect(await json(response)).toMatchObject({ note: "Already processed" });
    expect(h.db.rows("vouchers")).toHaveLength(1);
  });

  it("issues exactly one voucher for concurrent duplicate callbacks", async () => {
    const responses = await Promise.all([send(), send(), send(), send()]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(h.db.rows("vouchers")).toHaveLength(1);
    expect(payment().status).toBe("success");
  });

  it("allows a failed payment to complete after a later successful callback", async () => {
    payment().status = "failed";
    await send();
    expect(payment().status).toBe("success");
    expect(h.db.rows("vouchers")).toHaveLength(1);
  });

  it("releases the claim after voucher creation fails so a callback retry can finish", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.db.failNext("vouchers", "insert", "disk full");
    const first = await send();
    expect(first.status).toBe(500);
    expect(payment().status).toBe("pending");

    expect((await send()).status).toBe(200);
    expect(payment().status).toBe("success");
    expect(h.db.rows("vouchers")).toHaveLength(1);
  });

  it("sets an expiry but issues no voucher for non-hotspot packages", async () => {
    payment().package_id = PPPOE_PKG;
    await send();
    expect(h.db.rows("vouchers")).toHaveLength(0);
    expect(payment()).toMatchObject({ status: "success", voucher_code: null });
    expect(payment().expires_at).toBeTruthy();
  });
});

describe("tenant Daraja callback: smart TV payments", () => {
  const TV = "tv-1";
  const hoursFromNow = (value: unknown) =>
    (new Date(String(value)).getTime() - Date.now()) / 3_600_000;
  const device = () => h.db.rows("tv_devices").find((row) => row.id === TV)!;
  const tvPayment = (fields: Record<string, unknown> = {}) => {
    h.db.seed("tv_devices", [
      {
        id: TV,
        tenant_id: TENANT,
        mac_address: "AA:BB:CC:DD:EE:FF",
        status: "pending",
        expires_at: null,
        ...fields,
      },
    ]);
    payment().tv_device_id = TV;
  };

  it("activates the TV for the package duration without issuing a voucher", async () => {
    tvPayment();
    expect((await send()).status).toBe(200);
    expect(device().status).toBe("active");
    expect(hoursFromNow(device().expires_at)).toBeGreaterThan(1.9);
    expect(hoursFromNow(device().expires_at)).toBeLessThan(2.1);
    expect(h.db.rows("vouchers")).toHaveLength(0);
    expect(payment()).toMatchObject({ status: "success", voucher_code: null });
  });

  it("adds a TV renewal on top of remaining time", async () => {
    tvPayment({
      status: "active",
      expires_at: new Date(Date.now() + 5 * 3_600_000).toISOString(),
    });
    await send();
    expect(hoursFromNow(device().expires_at)).toBeGreaterThan(6.9);
    expect(hoursFromNow(device().expires_at)).toBeLessThan(7.1);
  });

  it("does not extend the TV twice after a retried callback", async () => {
    tvPayment();
    await send();
    const firstExpiry = device().expires_at;
    payment().status = "pending";
    await send();
    expect(device().expires_at).toBe(firstExpiry);
    expect(payment().status).toBe("success");
  });

  it("does not activate a device belonging to another tenant", async () => {
    h.db.seed("tv_devices", [
      {
        id: TV,
        tenant_id: OTHER_TENANT,
        mac_address: "AA:BB:CC:DD:EE:FF",
        status: "pending",
        expires_at: null,
      },
    ]);
    payment().tv_device_id = TV;
    await send();
    expect(device().status).toBe("pending");
    expect(device().expires_at).toBeNull();
  });

  it("keeps a blocked TV blocked after payment", async () => {
    tvPayment({ status: "blocked" });
    await send();
    expect(device().status).toBe("blocked");
    expect(payment().status).toBe("success");
  });
});
