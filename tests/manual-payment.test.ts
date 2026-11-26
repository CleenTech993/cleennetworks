import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

const darajaMock = vi.hoisted(() => ({
  getDetails: vi.fn(),
  requestStatus: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@/lib/daraja.server", () => ({
  getTenantManualPaymentDetails: darajaMock.getDetails,
  requestTenantTransactionStatus: darajaMock.requestStatus,
}));
vi.mock("@/lib/platform-billing.server", () => ({
  tenantServiceRestriction: async () => null,
  tenantServiceRestrictionMessage: () => "Service unavailable.",
}));
vi.mock("@/lib/maintenance.server", () => ({
  portalMaintenanceBlock: async () => null,
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => "portal.test" }));

import { Route as ManualPaymentRoute } from "@/routes/api/public/portal/$slug/manual-payment";
import { Route as TransactionStatusRoute } from "@/routes/api/public/mpesa/transaction-status.$token";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PACKAGE = "22222222-2222-4222-8222-222222222222";
const PAYMENT = "33333333-3333-4333-8333-333333333333";
const RECEIPT = "QWE123ABC";
const PARAMS = { slug: "acme" };

beforeEach(() => {
  darajaMock.getDetails.mockReset().mockResolvedValue({
    merchantType: "paybill",
    shortcode: "123456",
    verificationConfigured: true,
  });
  darajaMock.requestStatus.mockReset().mockResolvedValue(undefined);
  h.db = new FakeDb()
    .seed("tenants", [{ id: TENANT, slug: "acme" }])
    .seed("packages", [
      {
        id: PACKAGE,
        tenant_id: TENANT,
        kind: "hotspot",
        duration_value: 60,
        duration_unit: "minutes",
      },
    ])
    .seed("payments", [
      {
        id: PAYMENT,
        tenant_id: TENANT,
        provider: "daraja",
        status: "failed",
        package_id: PACKAGE,
        customer_id: null,
        phone: "254712345678",
        amount: 50,
        tv_device_id: null,
        expires_at: null,
        customer_invoice_id: null,
        created_at: new Date().toISOString(),
        mpesa_receipt: null,
        manual_mpesa_receipt: null,
        manual_verification_status: null,
        manual_verification_token_hash: null,
        manual_verification_error: null,
        manual_verification_requested_at: null,
      },
    ]);
});

describe("manual M-Pesa payment verification", () => {
  it("requests a Daraja status query and stores only a hashed callback token", async () => {
    const response = await call(ManualPaymentRoute, "POST", {
      params: PARAMS,
      ip: freshIp(),
      body: { paymentId: PAYMENT, receipt: RECEIPT },
    });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ status: "pending" });
    expect(darajaMock.requestStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        transactionId: RECEIPT,
        resultUrl: expect.stringMatching(/kind=result$/),
        queueTimeoutUrl: expect.stringMatching(/kind=timeout$/),
      }),
    );
    const payment = h.db.rows("payments")[0]!;
    expect(payment.manual_mpesa_receipt).toBe(RECEIPT);
    expect(payment.manual_verification_status).toBe("pending");
    expect(payment.manual_verification_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(darajaMock.requestStatus.mock.calls[0]![0].resultUrl).not.toContain(
      payment.manual_verification_token_hash,
    );
  });

  it("settles the package only after Daraja confirms the receipt and exact amount", async () => {
    await call(ManualPaymentRoute, "POST", {
      params: PARAMS,
      ip: freshIp(),
      body: { paymentId: PAYMENT, receipt: RECEIPT },
    });
    const callbackUrl = darajaMock.requestStatus.mock.calls[0]![0].resultUrl as string;
    const token = new URL(callbackUrl).pathname.split("/").pop()!;
    const response = await call(TransactionStatusRoute, "POST", {
      params: { token },
      url: `${callbackUrl}`,
      body: {
        Result: {
          ResultCode: 0,
          TransactionID: RECEIPT,
          ResultParameters: {
            ResultParameter: [
              { Key: "TransactionStatus", Value: "Completed" },
              { Key: "ReceiptNo", Value: RECEIPT },
              { Key: "Amount", Value: "50.00" },
            ],
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(h.db.rows("payments")[0]).toMatchObject({
      status: "success",
      mpesa_receipt: RECEIPT,
      manual_verification_status: "verified",
    });
  });

  it("does not activate access when the verified amount differs", async () => {
    await call(ManualPaymentRoute, "POST", {
      params: PARAMS,
      ip: freshIp(),
      body: { paymentId: PAYMENT, receipt: RECEIPT },
    });
    const callbackUrl = darajaMock.requestStatus.mock.calls[0]![0].resultUrl as string;
    const token = new URL(callbackUrl).pathname.split("/").pop()!;
    await call(TransactionStatusRoute, "POST", {
      params: { token },
      url: callbackUrl,
      body: {
        Result: {
          ResultCode: 0,
          TransactionID: RECEIPT,
          ResultParameters: {
            ResultParameter: [
              { Key: "TransactionStatus", Value: "Completed" },
              { Key: "ReceiptNo", Value: RECEIPT },
              { Key: "Amount", Value: "25.00" },
            ],
          },
        },
      },
    });

    expect(h.db.rows("payments")[0]).toMatchObject({
      status: "failed",
      mpesa_receipt: null,
      manual_verification_status: "failed",
    });
  });
});
