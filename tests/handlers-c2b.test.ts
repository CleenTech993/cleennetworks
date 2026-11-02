import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@/lib/tenant-service-secrets.server", () => ({
  loadTenantServiceSecrets: vi.fn(),
}));
import { loadTenantServiceSecrets } from "@/lib/tenant-service-secrets.server";
import { Route } from "@/routes/api/public/mpesa/c2b.$tenantId.$shortcode";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CUSTOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const callback = (fields: Record<string, unknown> = {}) => ({
  TransID: "QAB123XYZ",
  TransTime: "20261101230000",
  TransAmount: "500",
  BusinessShortCode: "123456",
  BillRefNumber: "alice",
  MSISDN: "254712345678",
  FirstName: "Alice",
  ...fields,
});

const send = (body: unknown = callback()) =>
  call(Route, "POST", {
    params: { tenantId: TENANT, shortcode: "123456" },
    body,
  });

beforeEach(() => {
  h.db = new FakeDb()
    .seed("tenants", [{ id: TENANT, mpesa_paybill: "123456", mpesa_till: "654321" }])
    .seed("customers", [
      {
        id: CUSTOMER,
        tenant_id: TENANT,
        customer_type: "pppoe",
        pppoe_username: "alice",
        phone: "254712345678",
      },
    ]);
  vi.mocked(loadTenantServiceSecrets).mockResolvedValue({ MPESA_SHORTCODE: "123456" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tenant direct M-Pesa C2B callback", () => {
  it("records the transaction for manual review and suggests a PPPoE account-reference match", async () => {
    const response = await send();

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ ResultCode: 0 });
    expect(h.db.rows("direct_mpesa_transactions")).toHaveLength(1);
    expect(h.db.rows("direct_mpesa_transactions")[0]).toMatchObject({
      tenant_id: TENANT,
      shortcode: "123456",
      transaction_id: "QAB123XYZ",
      amount: 500,
      bill_ref_number: "alice",
      phone: "254712345678",
      suggested_customer_id: CUSTOMER,
      status: "received",
    });
    expect(h.db.rows("payments")).toHaveLength(0);
  });

  it("does not treat C2B v2's masked MSISDN as a real phone number", async () => {
    const response = await send(
      callback({ BillRefNumber: "unmatched-reference", MSISDN: "2547 ***** 126" }),
    );

    expect(response.status).toBe(200);
    expect(h.db.rows("direct_mpesa_transactions")[0]).toMatchObject({
      phone: null,
      suggested_customer_id: null,
    });
  });

  it("acknowledges a duplicate callback without creating another transaction", async () => {
    await send();

    const response = await send();

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ ResultCode: 0 });
    expect(h.db.rows("direct_mpesa_transactions")).toHaveLength(1);
  });

  it("rejects a callback whose shortcode is not configured for the tenant", async () => {
    const response = await send(callback({ BusinessShortCode: "999999" }));

    expect(response.status).toBe(400);
    expect(h.db.rows("direct_mpesa_transactions")).toHaveLength(0);
  });

  it("rejects an otherwise valid callback sent to a different tenant shortcode path", async () => {
    const response = await call(Route, "POST", {
      params: { tenantId: TENANT, shortcode: "654321" },
      body: callback(),
    });

    expect(response.status).toBe(400);
    expect(h.db.rows("direct_mpesa_transactions")).toHaveLength(0);
  });
});
