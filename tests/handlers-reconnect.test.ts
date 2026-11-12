import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@/lib/platform-billing.server", () => ({
  tenantServiceRestriction: vi.fn(async () => null),
  tenantServiceRestrictionMessage: vi.fn(() => "Service unavailable"),
}));

import { Route } from "@/routes/api/public/portal/$slug/reconnect";

const TENANT = "11111111-1111-1111-1111-111111111111";
const ROUTER = "22222222-2222-4222-8222-222222222222";
const OTHER_ROUTER = "33333333-3333-4333-8333-333333333333";
const RECEIPT = "SFE1A2B3CD";
const MAC = "AA:BB:CC:DD:EE:02";
const OLD_MAC = "AA:BB:CC:DD:EE:04";

const reconnect = (mpesaCode: string, phone?: string, mac?: string, routerId?: string) =>
  call(Route, "POST", {
    body: { mpesaCode, phone, mac, routerId },
    ip: freshIp(),
    params: { slug: "acme" },
  });

beforeEach(() => {
  h.db = new FakeDb()
    .seed("tenants", [{ id: TENANT, slug: "acme" }])
    .seed("routers", [
      { id: ROUTER, tenant_id: TENANT },
      { id: OTHER_ROUTER, tenant_id: TENANT },
    ])
    .seed("packages", [
      {
        id: "hotspot-package",
        tenant_id: TENANT,
        kind: "hotspot",
        device_limit: 1,
        name: "One hour",
        duration_value: 1,
        duration_unit: "hours",
      },
    ])
    .seed("payments", [
      {
        id: "payment-1",
        tenant_id: TENANT,
        status: "success",
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        phone: "254712345678",
        mpesa_receipt: RECEIPT,
        voucher_code: null,
        package_id: "hotspot-package",
        bound_mac: null,
        created_at: new Date().toISOString(),
      },
    ]);
});

afterEach(() => vi.restoreAllMocks());

describe("portal reconnect by M-Pesa confirmation", () => {
  it("reconnects with a pasted full confirmation SMS", async () => {
    const response = await reconnect(
      "SFE1A2B3CD Confirmed. Ksh50.00 sent to ACME ISP on 6/11/26 at 1:35 PM.",
      "0712345678",
      MAC,
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ active: true, access_code: RECEIPT });
    expect(h.db.rows("payments")[0].bound_mac).toBe(MAC);
  });

  it("requires and permanently binds a one-device code to the requesting MAC", async () => {
    expect(await json(await reconnect(RECEIPT, undefined, undefined))).toMatchObject({
      active: false,
      reason: "Reconnect from the hotspot network so this device can be secured.",
    });
    expect(await json(await reconnect(RECEIPT, undefined, MAC))).toMatchObject({ active: true });
    expect(await json(await reconnect(RECEIPT, undefined, "AA:BB:CC:DD:EE:04"))).toMatchObject({
      active: false,
      reason: "This M-Pesa access code is already assigned to another device.",
    });
  });

  it("moves a paid one-device code to a new randomized MAC when the old device is offline", async () => {
    h.db.rows("payments")[0].bound_mac = OLD_MAC;
    h.db.seed("router_devices", [
      {
        tenant_id: TENANT,
        router_id: ROUTER,
        mac: OLD_MAC,
        authorized: false,
        last_seen_at: new Date().toISOString(),
      },
    ]);

    expect(await json(await reconnect(RECEIPT, "0712345678", MAC, ROUTER))).toMatchObject({
      active: true,
      access_code: RECEIPT,
    });
    expect(h.db.rows("payments")[0].bound_mac).toBe(MAC);
  });

  it("does not move the paid code while the previously bound device is still online", async () => {
    h.db.rows("payments")[0].bound_mac = OLD_MAC;
    h.db.seed("router_devices", [
      {
        tenant_id: TENANT,
        router_id: ROUTER,
        mac: OLD_MAC,
        authorized: true,
        last_seen_at: new Date().toISOString(),
      },
    ]);

    expect(await json(await reconnect(RECEIPT, "0712345678", MAC, ROUTER))).toMatchObject({
      active: false,
      reason: expect.stringContaining("still active on another device"),
    });
    expect(h.db.rows("payments")[0].bound_mac).toBe(OLD_MAC);
  });

  it("does not move the paid code to a different hotspot", async () => {
    h.db.rows("payments")[0].bound_mac = OLD_MAC;
    h.db.rows("payments")[0].router_id = ROUTER;

    expect(await json(await reconnect(RECEIPT, "0712345678", MAC, OTHER_ROUTER))).toMatchObject({
      active: false,
      reason: "Reconnect through the hotspot where this access code was purchased.",
    });
    expect(h.db.rows("payments")[0].bound_mac).toBe(OLD_MAC);
  });

  it("allows moving the paid code when the old router report is stale", async () => {
    h.db.rows("payments")[0].bound_mac = OLD_MAC;
    h.db.seed("router_devices", [
      {
        tenant_id: TENANT,
        router_id: ROUTER,
        mac: OLD_MAC,
        authorized: true,
        last_seen_at: new Date(Date.now() - 3 * 60_000).toISOString(),
      },
    ]);

    expect(await json(await reconnect(RECEIPT, "0712345678", MAC, ROUTER))).toMatchObject({
      active: true,
    });
    expect(h.db.rows("payments")[0].bound_mac).toBe(MAC);
  });

  it("does not reveal a payment when the receipt or optional phone does not match", async () => {
    expect((await reconnect("OTHER12345", undefined, MAC)).status).toBe(200);
    expect(await json(await reconnect(RECEIPT, "0712000000", MAC))).toMatchObject({
      active: false,
      reason: "No purchase found",
    });
  });

  it("does not grant access to a pending payment or one without a future expiry", async () => {
    h.db.rows("payments")[0].status = "pending";
    expect(await json(await reconnect(RECEIPT))).toMatchObject({
      active: false,
      reason: "No purchase found",
    });

    h.db.rows("payments")[0].status = "success";
    h.db.rows("payments")[0].expires_at = null;
    expect(await json(await reconnect(RECEIPT))).toMatchObject({
      active: false,
      reason: "Package expired",
    });
  });

  it("rejects an arbitrary message without a single confirmed receipt", async () => {
    const response = await reconnect("Your payment is processing, please wait.", undefined, MAC);
    expect(response.status).toBe(400);
  });
});
