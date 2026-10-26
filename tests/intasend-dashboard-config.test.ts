// The credentials saved on the dashboard must be what the live payment code actually uses.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => "portal.test" }));

import { Route as Webhook } from "@/routes/api/public/intasend/webhook";
import { resetGatewaySecretCache, saveGatewaySecret } from "@/lib/gateway-secrets.server";
import { intasendCheckKey, intasendConfigured, intasendStkPush } from "@/lib/intasend.server";
import { loadPlatformMpesaConfig } from "@/lib/mpesa.server";
import { resolveProvider } from "@/lib/payment-gateway.server";

const KEY = "ISSecretKey_test_dashboardkey000111";
const CHAL = "dashboard-challenge-value-1";
const USER = "99999999-0000-0000-0000-000000000001";

let fetchMock: ReturnType<typeof vi.fn>;
const stubFetch = (status: number, body: unknown = {}) => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
};
const hook = (challenge: string | undefined, topic = "collection_event") =>
  call(Webhook, "POST", { body: { challenge, topic, invoice_id: "x" }, ip: freshIp() });

beforeEach(() => {
  h.db = new FakeDb()
    .seed("platform_gateway_secrets", [])
    .seed("platform_mpesa_config", [
      { id: 1, active_provider: "intasend", mpesa_env: "production" },
    ]);
  resetGatewaySecretCache();
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-key-material-aaaaaaaaaaaaaaaa";
  delete process.env["INTASEND_SECRET_KEY"];
  delete process.env["INTASEND_WEBHOOK_CHALLENGE"];
  delete process.env["PAYHERO_API_USERNAME"];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("webhook uses the dashboard challenge", () => {
  it("503 when no challenge exists anywhere", async () => {
    expect((await hook("whatever")).status).toBe(503);
  });

  it("accepts the saved challenge and rejects any other", async () => {
    await saveGatewaySecret("INTASEND_WEBHOOK_CHALLENGE", CHAL, USER);
    resetGatewaySecretCache(); // cold instance: the webhook must load it by itself
    expect((await hook(CHAL, "something_else")).status).toBe(200);
    expect((await hook("wrong-challenge-value")).status).toBe(401);
    expect((await hook(undefined)).status).toBe(401);
  });
});

describe("payments use the dashboard key", () => {
  it("sends the saved key (not an environment one) when starting a prompt", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", KEY, USER);
    process.env["INTASEND_SECRET_KEY"] = "ISSecretKey_test_environmentkey999";
    resetGatewaySecretCache();
    stubFetch(201, { invoice: { invoice_id: "INV1", state: "PENDING", api_ref: "ref" } });
    await intasendStkPush({ amount: 50, phone: "254712345678", reference: "ref" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${KEY}`);
  });

  it("checkout picks IntaSend once a key is saved, even though no env var is set", async () => {
    expect(intasendConfigured()).toBe(false);
    await saveGatewaySecret("INTASEND_SECRET_KEY", KEY, USER);
    resetGatewaySecretCache();
    const cfg = await loadPlatformMpesaConfig(); // loads the dashboard secrets before the provider is resolved
    expect(resolveProvider(cfg)).toBe("intasend");
  });
});

describe("Test connection", () => {
  it("not_set when there is no key", async () => {
    stubFetch(200);
    expect(await intasendCheckKey()).toEqual({ result: "not_set" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "rejected"],
    [403, "rejected"],
    [404, "accepted"],
    [400, "accepted"],
    [200, "accepted"],
    [503, "unreachable"],
  ])("IntaSend answers %s -> %s", async (status, expected) => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", KEY, USER);
    stubFetch(status as number, { detail: "private account data" });
    const r = await intasendCheckKey();
    expect(r).toMatchObject({ result: expected });
    expect(JSON.stringify(r)).not.toContain("private account data");
  });

  it("unreachable when the network fails", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", KEY, USER);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    expect(await intasendCheckKey()).toMatchObject({ result: "unreachable" });
  });
});
