import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "./helpers/setup";

const secretsMock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/tenant-service-secrets.server", () => ({
  loadTenantServiceSecrets: secretsMock.load,
}));

import { queryDarajaStkPush, registerDarajaC2bUrl, startDarajaStkPush } from "@/lib/daraja.server";

const TENANT = "11111111-1111-1111-1111-111111111111";
const PAYMENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
  secretsMock.load.mockReset().mockResolvedValue({
    MPESA_ENV: "sandbox",
    MPESA_SHORTCODE: "174379",
    MPESA_CONSUMER_KEY: "consumer-key",
    MPESA_CONSUMER_SECRET: "consumer-secret",
    MPESA_PASSKEY: "passkey",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tenant Daraja STK Push", () => {
  it("uses the listed production endpoints for STK, STK query, and C2B registration", async () => {
    secretsMock.load.mockResolvedValue({
      MPESA_ENV: "production",
      MPESA_SHORTCODE: "123456",
      MPESA_CONSUMER_KEY: "consumer-key",
      MPESA_CONSUMER_SECRET: "consumer-secret",
      MPESA_PASSKEY: "passkey",
    });
    const fetchSpy = stubFetch((url) =>
      url.includes("/oauth/")
        ? Response.json({ access_token: "access-token" })
        : url.endsWith("/stkpush/v1/processrequest")
          ? Response.json({
              ResponseCode: "0",
              CheckoutRequestID: "ws_CO_live",
              MerchantRequestID: "merchant-live",
            })
          : url.endsWith("/stkpushquery/v1/query")
            ? Response.json({ ResponseCode: "0", ResultCode: "0", ResultDesc: "Success" })
            : Response.json({ ResponseCode: "00000000" }),
    );

    await startDarajaStkPush({
      tenantId: TENANT,
      amount: 50,
      phone: "0712345678",
      paymentId: PAYMENT,
      callbackUrl: `https://portal.test/api/public/mpesa/callback/${TENANT}`,
      description: "Internet",
    });
    await queryDarajaStkPush(TENANT, "ws_CO_live");
    await registerDarajaC2bUrl({
      tenantId: TENANT,
      shortcode: "123456",
      validationUrl: "https://portal.test/api/public/mpesa/c2b-validation/path",
      confirmationUrl: "https://portal.test/api/public/mpesa/c2b/path",
    });

    const urls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(urls).toContain(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    );
    expect(urls).toContain("https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest");
    expect(urls).toContain("https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query");
    expect(urls).toContain("https://api.safaricom.co.ke/mpesa/c2b/v2/registerurl");
  });

  it("uses the tenant sandbox credentials, records the request ids, and sends the expected amount", async () => {
    const fetchSpy = stubFetch((url) =>
      url.includes("/oauth/")
        ? Response.json({ access_token: "access-token" })
        : Response.json({
            ResponseCode: "0",
            CheckoutRequestID: "ws_CO_123",
            MerchantRequestID: "merchant-123",
          }),
    );

    const result = await startDarajaStkPush({
      tenantId: TENANT,
      amount: 50.01,
      phone: "0712345678",
      paymentId: PAYMENT,
      callbackUrl: `https://portal.test/api/public/mpesa/callback/${TENANT}`,
      description: "hotspot",
    });

    expect(result).toEqual({
      checkoutRequestId: "ws_CO_123",
      merchantRequestId: "merchant-123",
    });
    expect(secretsMock.load).toHaveBeenCalledWith(TENANT);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    );
    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: `Basic ${btoa("consumer-key:consumer-secret")}`,
    });

    const request = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(request).toMatchObject({
      BusinessShortCode: "174379",
      TransactionType: "CustomerPayBillOnline",
      Amount: 51,
      PartyA: "254712345678",
      PartyB: "174379",
      PhoneNumber: "254712345678",
      CallBackURL: `https://portal.test/api/public/mpesa/callback/${TENANT}`,
      AccountReference: "aaaaaaaabbbb",
      Timestamp: "20261024150000",
    });
    expect(request.Password).toBe(btoa(`174379passkey${request.Timestamp}`));
  });

  it("registers tenant C2B validation and confirmation callbacks", async () => {
    const fetchSpy = stubFetch((url) =>
      url.includes("/oauth/")
        ? Response.json({ access_token: "access-token" })
        : Response.json({ ResponseCode: "0" }),
    );

    await registerDarajaC2bUrl({
      tenantId: TENANT,
      shortcode: "123456",
      validationUrl: "https://portal.test/api/public/mpesa/c2b-validation/path",
      confirmationUrl: "https://portal.test/api/public/mpesa/c2b/path",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe(
      "https://sandbox.safaricom.co.ke/mpesa/c2b/v2/registerurl",
    );
    expect(JSON.parse(String(fetchSpy.mock.calls[1][1]?.body))).toEqual({
      ShortCode: "123456",
      ResponseType: "Completed",
      ValidationURL: "https://portal.test/api/public/mpesa/c2b-validation/path",
      ConfirmationURL: "https://portal.test/api/public/mpesa/c2b/path",
    });
  });

  it("rejects C2B callback registration when Daraja does not accept a shortcode", async () => {
    stubFetch((url) =>
      url.includes("/oauth/")
        ? Response.json({ access_token: "access-token" })
        : Response.json({ ResponseCode: "1" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      registerDarajaC2bUrl({
        tenantId: TENANT,
        shortcode: "123456",
        validationUrl: "https://portal.test/validate",
        confirmationUrl: "https://portal.test/confirm",
      }),
    ).rejects.toThrow("Safaricom did not register the C2B callback");
  });

  it("does not expose provider response text when Daraja rejects a request", async () => {
    stubFetch((url) =>
      url.includes("/oauth/")
        ? Response.json({ access_token: "access-token" })
        : Response.json({ errorMessage: "private account details" }, { status: 401 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      startDarajaStkPush({
        tenantId: TENANT,
        amount: 50,
        phone: "254712345678",
        paymentId: PAYMENT,
        callbackUrl: "https://portal.test/callback",
        description: "Internet",
      }),
    ).rejects.toThrow("Could not send the M-Pesa prompt");
  });

  it("does not confuse an accepted query request with a completed payment", async () => {
    stubFetch((url) =>
      url.includes("/oauth/")
        ? Response.json({ access_token: "access-token" })
        : Response.json({ ResponseCode: "0", ResponseDescription: "request accepted" }),
    );

    await expect(queryDarajaStkPush(TENANT, "ws_CO_123")).resolves.toMatchObject({
      resultCode: null,
    });
  });

  it("returns the transaction result code from a completed STK query", async () => {
    stubFetch((url) =>
      url.includes("/oauth/")
        ? Response.json({ access_token: "access-token" })
        : Response.json({
            ResponseCode: "0",
            ResultCode: "0",
            ResultDesc: "The service request is processed successfully",
          }),
    );

    await expect(queryDarajaStkPush(TENANT, "ws_CO_123")).resolves.toMatchObject({
      resultCode: "0",
    });
  });
});
