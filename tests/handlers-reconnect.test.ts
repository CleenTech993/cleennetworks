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
const RECEIPT = "SFE1A2B3CD";

const reconnect = (mpesaCode: string, phone?: string) =>
  call(Route, "POST", {
    body: { mpesaCode, phone },
    ip: freshIp(),
    params: { slug: "acme" },
  });

beforeEach(() => {
  h.db = new FakeDb()
    .seed("tenants", [{ id: TENANT, slug: "acme" }])
    .seed("payments", [
      {
        id: "payment-1",
        tenant_id: TENANT,
        status: "success",
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        phone: "254712345678",
        mpesa_receipt: RECEIPT,
        voucher_code: "VOUCHER123",
        package_id: null,
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
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ active: true, voucher_code: "VOUCHER123" });
  });

  it("does not reveal a payment when the receipt or optional phone does not match", async () => {
    expect((await reconnect("OTHER12345")).status).toBe(200);
    expect(await json(await reconnect(RECEIPT, "0712000000"))).toMatchObject({
      active: false,
      reason: "No purchase found",
    });
  });

  it("rejects an arbitrary message without a single confirmed receipt", async () => {
    const response = await reconnect("Your payment is processing, please wait.");
    expect(response.status).toBe(400);
  });
});