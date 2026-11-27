import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { h } from "./helpers/setup";

const darajaMock = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@/lib/daraja.server", () => ({ queryDarajaStkPush: darajaMock.query }));

import { Route } from "@/routes/api/public/mpesa/callback.$tenantId";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "99999999-9999-9999-9999-999999999999";
const PAY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const HOTSPOT_PKG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PPPOE_PKG = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PPPOE_CUSTOMER = "dddddddd-dddd-dddd-dddd-dddddddddddd";

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
  darajaMock.query.mockReset().mockResolvedValue({
    resultCode: "0",
    resultDescription: "success",
  });
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
  h.db.rpcs.settle_presynced_hotspot_payment = (args) => {
    const pay = h.db.rows("payments").find((row) => row.id === args.p_payment_id);
    if (!pay) return { error: { message: "payment missing" } };
    const setting = h.db
      .rows("voucher_inventory_settings")
      .find(
        (row) =>
          row.tenant_id === pay.tenant_id &&
          row.router_id === pay.router_id &&
          row.package_id == null &&
          row.enabled === true,
      );
    let voucher =
      setting && pay.bound_mac
        ? h.db
            .rows("vouchers")
            .find(
              (row) =>
                row.tenant_id === pay.tenant_id &&
                row.router_id === pay.router_id &&
                row.package_id == null &&
                row.status === "unused" &&
                row.sync_status === "available" &&
                row.payment_id == null,
            )
        : undefined;
    const assigned = Boolean(voucher);
    if (voucher) {
      voucher.payment_id = pay.id;
      voucher.package_id = pay.package_id;
      voucher.bound_mac = pay.bound_mac ?? null;
      voucher.expires_at = null;
      voucher.activation_started_at = null;
    } else {
      voucher = {
        id: `generated-${pay.id}`,
        tenant_id: pay.tenant_id,
        router_id: pay.router_id ?? null,
        package_id: pay.package_id,
        bound_mac: pay.bound_mac ?? null,
        code: "PAYVOUCHER234567",
        status: "unused",
        sync_status: "legacy",
        payment_id: pay.id,
        activation_started_at: new Date().toISOString(),
        expires_at: args.p_legacy_expires_at,
      };
      h.db.seed("vouchers", [voucher]);
    }
    pay.status = "success";
    pay.mpesa_receipt = args.p_receipt;
    pay.raw_callback = args.p_raw_callback;
    pay.voucher_code = voucher.code;
    pay.fulfillment_status = assigned ? "assigned" : "generated";
    pay.fulfilled_at = new Date().toISOString();
    pay.expires_at = pay.fulfillment_status === "assigned" ? null : args.p_legacy_expires_at;
    return {
      data: [
        {
          assigned_voucher_code: voucher.code,
          fulfillment_status: pay.fulfillment_status,
        },
      ],
    };
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const payment = () => h.db.rows("payments").find((row) => row.id === PAY)!;

describe("tenant Daraja callback", () => {
  it("generates a voucher after successful payment when pre-sync is not enabled", async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(darajaMock.query).toHaveBeenCalledWith(TENANT, "ws_CO_1");
    expect(h.db.log).toContainEqual(
      expect.objectContaining({ table: "rpc", op: "settle_presynced_hotspot_payment" }),
    );

    expect(h.db.rows("vouchers")).toHaveLength(1);
    expect(h.db.rows("vouchers")[0]).toMatchObject({
      package_id: HOTSPOT_PKG,
      payment_id: PAY,
      sync_status: "legacy",
      status: "unused",
    });
    expect(payment()).toMatchObject({
      status: "success",
      mpesa_receipt: "DAR1234567",
      voucher_code: "PAYVOUCHER234567",
      fulfillment_status: "generated",
    });
    const hours = (new Date(String(payment().expires_at)).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThan(2.1);
  });

  it("assigns unbound router stock to the paid package and customer MAC", async () => {
    payment().router_id = "router-one";
    payment().bound_mac = "02:00:00:00:00:01";
    h.db.seed("voucher_inventory_settings", [
      {
        tenant_id: TENANT,
        router_id: "router-one",
        package_id: null,
        enabled: true,
      },
    ]);
    h.db.seed("vouchers", [
      {
        id: "ready-one",
        tenant_id: TENANT,
        router_id: "router-one",
        package_id: null,
        code: "READYCODE123",
        status: "unused",
        sync_status: "available",
        payment_id: null,
        expires_at: null,
      },
      {
        id: "ready-other-router",
        tenant_id: TENANT,
        router_id: "router-two",
        package_id: null,
        code: "OTHERROUTER1",
        status: "unused",
        sync_status: "available",
        payment_id: null,
        expires_at: null,
      },
    ]);

    const response = await send();

    expect(response.status).toBe(200);
    expect(payment()).toMatchObject({
      status: "success",
      voucher_code: "READYCODE123",
      fulfillment_status: "assigned",
      expires_at: null,
    });
    expect(h.db.rows("vouchers")[0]).toMatchObject({
      payment_id: PAY,
      package_id: HOTSPOT_PKG,
      bound_mac: "02:00:00:00:00:01",
      expires_at: null,
    });
    expect(h.db.rows("vouchers")[1].payment_id).toBeNull();
  });

  it("records M-Pesa failure and issues nothing", async () => {
    darajaMock.query.mockResolvedValue({
      resultCode: "1032",
      resultDescription: "cancelled",
    });
    await send(callbackBody({ resultCode: 1032 }));
    expect(payment().status).toBe("failed");
    expect(darajaMock.query).toHaveBeenCalledWith(TENANT, "ws_CO_1");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("does not settle callback details that do not match the stored amount or phone", async () => {
    await send(callbackBody({ amount: 1 }));
    expect(darajaMock.query).not.toHaveBeenCalled();
    expect(payment().status).toBe("pending");

    await send(callbackBody({ phone: 254700000000 }));
    expect(darajaMock.query).not.toHaveBeenCalled();
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("does not settle a success callback unless Daraja confirms success", async () => {
    darajaMock.query.mockResolvedValue({
      resultCode: "1032",
      resultDescription: "cancelled",
    });

    const response = await send();

    expect(response.status).toBe(200);
    expect(payment().status).toBe("failed");
    expect(payment().mpesa_receipt ?? null).toBeNull();
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("keeps the payment pending when Daraja reports the transaction is still processing", async () => {
    darajaMock.query.mockResolvedValue({
      resultCode: null,
      resultDescription: "The transaction is being processed",
    });

    const response = await send();

    expect(response.status).toBe(202);
    expect(payment().status).toBe("pending");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("returns a retryable error when Daraja cannot verify a success callback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    darajaMock.query.mockRejectedValue(new Error("Daraja unavailable"));

    const response = await send();

    expect(response.status).toBe(502);
    expect(payment().status).toBe("pending");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("ignores callbacks for another tenant and non-Daraja callback formats", async () => {
    const wrongTenant = await send(callbackBody(), OTHER_TENANT);
    expect(await json(wrongTenant)).toMatchObject({ note: "Unknown payment" });
    const oldGateway = await send({ response: { CheckoutRequestID: "ws_CO_1" } });
    expect(await json(oldGateway)).toMatchObject({ note: "Unknown callback" });
    expect(darajaMock.query).not.toHaveBeenCalled();
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

  it("returns a retryable error when the callback payment lookup fails", async () => {
    h.db.failNext("payments", "select", "database unavailable");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await send();

    expect(response.status).toBe(500);
    expect(payment().status).toBe("pending");
  });

  it("leaves payment pending when the package cannot be loaded during settlement", async () => {
    h.db.failNext("packages", "select", "database unavailable");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await send();

    expect(response.status).toBe(500);
    expect(payment().status).toBe("pending");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("is idempotent when a callback is replayed", async () => {
    await send();
    const response = await send();
    expect(await json(response)).toMatchObject({ note: "Already processed" });
    expect(h.db.rows("vouchers")).toHaveLength(1);
  });

  it("settles concurrent duplicate callbacks once and generates one voucher", async () => {
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

  it("backfills the receipt from a late callback without issuing another voucher", async () => {
    const existingVoucher = {
      id: "voucher-1",
      tenant_id: TENANT,
      package_id: HOTSPOT_PKG,
      payment_id: PAY,
      code: "EXISTING123",
    };
    h.db.seed("vouchers", [existingVoucher]);
    payment().status = "success";
    payment().voucher_code = existingVoucher.code;
    payment().mpesa_receipt = null;

    const response = await send();

    expect(response.status).toBe(200);
    expect(payment()).toMatchObject({
      status: "success",
      mpesa_receipt: "DAR1234567",
      voucher_code: existingVoucher.code,
    });
    expect(h.db.rows("vouchers")).toHaveLength(1);
    expect(darajaMock.query).toHaveBeenCalledWith(TENANT, "ws_CO_1");
  });

  it("releases the claim after package lookup fails so a callback retry can finish", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.db.failNext("packages", "select", "database unavailable");
    const first = await send();
    expect(first.status).toBe(500);
    expect(payment().status).toBe("pending");

    expect((await send()).status).toBe(200);
    expect(payment().status).toBe("success");
    expect(h.db.rows("vouchers")).toHaveLength(1);
  });

  it("renews a PPPoE account without issuing a voucher", async () => {
    payment().package_id = PPPOE_PKG;
    payment().customer_id = PPPOE_CUSTOMER;
    h.db.seed("customers", [
      {
        id: PPPOE_CUSTOMER,
        tenant_id: TENANT,
        customer_type: "pppoe",
        package_id: null,
        expires_at: null,
        status: "expired",
      },
    ]);
    await send();
    expect(h.db.rows("vouchers")).toHaveLength(0);
    expect(payment()).toMatchObject({ status: "success", voucher_code: null });
    expect(payment().expires_at).toBeTruthy();
    expect(h.db.rows("customers")[0]).toMatchObject({
      package_id: PPPOE_PKG,
      status: "active",
    });
    expect(h.db.rows("customers")[0].expires_at).toBe(payment().expires_at);
  });
});

it("does not assign pre-synced stock when checkout did not capture a client MAC", async () => {
  payment().router_id = "router-one";
  h.db
    .seed("voucher_inventory_settings", [
      {
        tenant_id: TENANT,
        router_id: "router-one",
        package_id: null,
        enabled: true,
      },
    ])
    .seed("vouchers", [
      {
        id: "ready-without-client",
        tenant_id: TENANT,
        router_id: "router-one",
        package_id: null,
        code: "NOMACSTOCK01",
        status: "unused",
        sync_status: "available",
        payment_id: null,
        expires_at: null,
      },
    ]);

  const response = await send();

  expect(response.status).toBe(200);
  expect(payment()).toMatchObject({ fulfillment_status: "generated" });
  expect(h.db.rows("vouchers")[0]).toMatchObject({
    code: "NOMACSTOCK01",
    package_id: null,
    payment_id: null,
    sync_status: "available",
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
