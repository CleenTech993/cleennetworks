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
vi.mock("@/lib/rate-limit.server", () => ({
  rateLimit: vi.fn(() => true),
}));

import { Route } from "@/routes/api/public/portal/$slug/payment-status";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "99999999-9999-9999-9999-999999999999";
const PAYMENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PACKAGE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const send = (slug = "tenant") =>
  call(Route, "GET", {
    url: `https://portal.test/status?id=${PAYMENT}`,
    params: { slug },
  });

beforeEach(() => {
  darajaMock.query.mockReset().mockResolvedValue({
    resultCode: "0",
    resultDescription: "success",
  });
  h.db = new FakeDb()
    .seed("tenants", [{ id: TENANT, slug: "tenant" }])
    .seed("packages", [
      {
        id: PACKAGE,
        tenant_id: TENANT,
        kind: "hotspot",
        duration_value: 2,
        duration_unit: "hours",
      },
    ])
    .seed("payments", [
      {
        id: PAYMENT,
        tenant_id: TENANT,
        package_id: PACKAGE,
        phone: "254712345678",
        amount: 50,
        status: "pending",
        created_at: new Date().toISOString(),
        provider: "daraja",
        checkout_request_id: "ws_CO_1",
        merchant_request_id: "merchant-1",
        tv_device_id: null,
        expires_at: null,
        mpesa_receipt: null,
        voucher_code: null,
      },
    ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("captive portal payment status recovery", () => {
  it("settles a pending payment when Daraja confirms success despite a missing callback", async () => {
    const response = await send();

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      id: PAYMENT,
      status: "success",
      mpesa_receipt: null,
    });
    expect(darajaMock.query).toHaveBeenCalledWith(TENANT, "ws_CO_1");
    expect(h.db.rows("vouchers")).toHaveLength(1);
    expect(h.db.rows("vouchers")[0]).toMatchObject({
      tenant_id: TENANT,
      package_id: PACKAGE,
      payment_id: PAYMENT,
    });
  });

  it("keeps the payment pending while Daraja has not returned a result", async () => {
    darajaMock.query.mockResolvedValue({
      resultCode: null,
      resultDescription: "request accepted",
    });

    const response = await send();

    expect(await json(response)).toMatchObject({ status: "pending" });
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("keeps waiting for a Daraja failure result during the prompt response window", async () => {
    darajaMock.query.mockResolvedValue({
      resultCode: "1032",
      resultDescription: "cancelled",
    });

    const response = await send();

    expect(await json(response)).toMatchObject({ status: "pending" });
    expect(h.db.rows("payments")[0].status).toBe("pending");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("marks a Daraja-confirmed failure after the prompt response window", async () => {
    h.db.rows("payments")[0].created_at = new Date(Date.now() - 3 * 60_000).toISOString();
    darajaMock.query.mockResolvedValue({
      resultCode: "1032",
      resultDescription: "cancelled",
    });

    const response = await send();

    expect(await json(response)).toMatchObject({ status: "failed" });
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("expires a stale pending payment when Daraja has no result", async () => {
    h.db.rows("payments")[0].created_at = new Date(Date.now() - 11 * 60_000).toISOString();
    darajaMock.query.mockResolvedValue({
      resultCode: null,
      resultDescription: "request accepted",
    });

    const response = await send();

    expect(await json(response)).toMatchObject({ status: "failed" });
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("does not query Daraja for a payment under another tenant", async () => {
    h.db.rows("payments")[0].tenant_id = OTHER_TENANT;

    const response = await send();

    expect(response.status).toBe(404);
    expect(darajaMock.query).not.toHaveBeenCalled();
  });

  it("keeps the payment pending and returns a retryable error if Daraja is unavailable", async () => {
    darajaMock.query.mockRejectedValue(new Error("Daraja unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await send();

    expect(response.status).toBe(502);
    expect(h.db.rows("payments")[0]).toMatchObject({ status: "pending" });
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });
});
