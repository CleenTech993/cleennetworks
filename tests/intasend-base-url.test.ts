// IntaSend has two separate servers: test keys only work on the sandbox, live keys only on the live site.
// Sending a key to the wrong one is refused, which looked like "IntaSend rejected the key".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import { intasendBaseUrl, intasendEnvironment } from "@/lib/intasend";
import { resetGatewaySecretCache, saveGatewaySecret } from "@/lib/gateway-secrets.server";
import { intasendCheckKey, intasendStkPush } from "@/lib/intasend.server";

const TEST_KEY = "ISSecretKey_test_0123456789abcdef";
const LIVE_KEY = "ISSecretKey_live_0123456789abcdef";
const USER = "99999999-0000-0000-0000-000000000001";

describe("intasendBaseUrl", () => {
  it("test keys use the sandbox", () => {
    expect(intasendBaseUrl(TEST_KEY)).toBe("https://sandbox.intasend.com");
    expect(intasendEnvironment(TEST_KEY)).toBe("sandbox");
  });
  it("live keys use the live server", () => {
    expect(intasendBaseUrl(LIVE_KEY)).toBe("https://payment.intasend.com");
    expect(intasendEnvironment(LIVE_KEY)).toBe("live");
  });
  it("an unrecognised or missing key falls back to live, never silently to the sandbox", () => {
    expect(intasendBaseUrl("something-else")).toBe("https://payment.intasend.com");
    expect(intasendBaseUrl(undefined)).toBe("https://payment.intasend.com");
  });
  it("an explicit override wins and loses a trailing slash", () => {
    expect(intasendBaseUrl(TEST_KEY, "https://proxy.example.com/")).toBe(
      "https://proxy.example.com",
    );
  });
});

let urls: string[] = [];
const stub = (status = 404, body: unknown = {}) => {
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(body), { status });
    }),
  );
};

beforeEach(() => {
  h.db = new FakeDb().seed("platform_gateway_secrets", []);
  resetGatewaySecretCache();
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-key-material-aaaaaaaaaaaaaaaa";
  for (const k of ["INTASEND_SECRET_KEY", "INTASEND_PUBLISHABLE_KEY", "INTASEND_BASE_URL"])
    delete process.env[k];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("requests go to the server that matches the saved key", () => {
  it("a test key is checked against the sandbox, and the result says so", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", TEST_KEY, USER);
    stub(404);
    expect(await intasendCheckKey()).toEqual({ result: "accepted", environment: "sandbox" });
    expect(urls).toEqual(["https://sandbox.intasend.com/api/v1/payment/status/"]);
  });

  it("a live key is checked against the live server", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", LIVE_KEY, USER);
    stub(404);
    expect(await intasendCheckKey()).toEqual({ result: "accepted", environment: "live" });
    expect(urls).toEqual(["https://payment.intasend.com/api/v1/payment/status/"]);
  });

  it("a refused key reports which server refused it", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", TEST_KEY, USER);
    stub(401);
    expect(await intasendCheckKey()).toEqual({ result: "rejected", environment: "sandbox" });
  });

  it("the STK prompt goes to the same server as the key", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", TEST_KEY, USER);
    stub(201, { invoice: { invoice_id: "INV1", state: "PENDING", api_ref: "ref" } });
    await intasendStkPush({ amount: 50, phone: "254712345678", reference: "ref" });
    expect(urls).toEqual(["https://sandbox.intasend.com/api/v1/payment/mpesa-stk-push/"]);

    await saveGatewaySecret("INTASEND_SECRET_KEY", LIVE_KEY, USER);
    stub(201, { invoice: { invoice_id: "INV2", state: "PENDING", api_ref: "ref2" } });
    await intasendStkPush({ amount: 50, phone: "254712345678", reference: "ref2" });
    expect(urls).toEqual(["https://payment.intasend.com/api/v1/payment/mpesa-stk-push/"]);
  });

  it("INTASEND_BASE_URL still overrides the choice", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", TEST_KEY, USER);
    process.env["INTASEND_BASE_URL"] = "https://proxy.example.com/";
    stub(404);
    await intasendCheckKey();
    expect(urls).toEqual(["https://proxy.example.com/api/v1/payment/status/"]);
  });
});
