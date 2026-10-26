// IntaSend must work with just the API key and secret key: no webhook. Payments are confirmed by asking
// IntaSend directly, even when the customer has closed the portal page.
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

import { Route as Heartbeat } from "@/routes/api/public/router/heartbeat.$token";
import { resetGatewaySecretCache, saveGatewaySecret } from "@/lib/gateway-secrets.server";
import {
  resetSweepThrottle,
  sweepIntasendIfDue,
  sweepPendingIntasendPayments,
} from "@/lib/intasend-reconcile.server";
import { intasendConfigured, intasendStkPush } from "@/lib/intasend.server";
import { checkIntasendCredentials } from "@/lib/intasend";

const SECRET = "ISSecretKey_test_secretsecret0001";
const PUBKEY = "ISPubKey_test_publicpublic00002";
const USER = "99999999-0000-0000-0000-000000000001";
const T = "11111111-1111-1111-1111-111111111111";
const PKG = "dddddddd-0000-0000-0000-000000000001";
const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();

const pay = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  tenant_id: T,
  package_id: PKG,
  phone: "254712345678",
  amount: 100,
  status: "pending",
  provider: "intasend",
  merchant_request_id: `INV-${id}`,
  mpesa_receipt: null,
  voucher_code: null,
  tv_device_id: null,
  expires_at: null,
  created_at: ago(120),
  ...over,
});
const invoiceFor = (p: { id: string; amount?: number }, state = "COMPLETE") => ({
  invoice: {
    invoice_id: `INV-${p.id}`,
    state,
    provider: "M-PESA",
    value: p.amount ?? 100,
    currency: "KES",
    account: "254712345678",
    api_ref: p.id,
    provider_ref: `RCP${p.id.slice(-4)}`,
    failed_reason: null,
    failed_code: null,
  },
});

let fetchCalls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
/** IntaSend stub: answers status checks from a map of invoice id -> reply. */
function intasendStub(replies: Record<string, { state: string; amount?: number } | number>) {
  fetchCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      fetchCalls.push({
        url,
        body,
        auth: (init.headers as Record<string, string>)["Authorization"],
      });
      const r = replies[body.invoice_id];
      if (typeof r === "number") return new Response("{}", { status: r });
      if (!r) return new Response("{}", { status: 404 });
      const id = String(body.invoice_id).replace("INV-", "");
      return new Response(JSON.stringify(invoiceFor({ id, amount: r.amount }, r.state)), {
        status: 200,
      });
    }),
  );
}

const P1 = "aaaaaaaa-0000-4000-8000-000000000001";
const P2 = "aaaaaaaa-0000-4000-8000-000000000002";
const P3 = "aaaaaaaa-0000-4000-8000-000000000003";

function setup(payments: ReturnType<typeof pay>[]) {
  h.db = new FakeDb()
    .seed("platform_gateway_secrets", [])
    .seed("payments", payments)
    .seed("vouchers", [])
    .seed("packages", [{ id: PKG, kind: "hotspot", duration_value: 1, duration_unit: "days" }]);
}

beforeEach(() => {
  resetGatewaySecretCache();
  resetSweepThrottle();
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-key-material-aaaaaaaaaaaaaaaa";
  for (const k of ["INTASEND_SECRET_KEY", "INTASEND_PUBLISHABLE_KEY", "INTASEND_WEBHOOK_CHALLENGE"])
    delete process.env[k];
  setup([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("works with only the keys (no webhook challenge anywhere)", () => {
  it("is configured with just the secret key", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", SECRET, USER);
    await saveGatewaySecret("INTASEND_PUBLISHABLE_KEY", PUBKEY, USER);
    expect(intasendConfigured()).toBe(true);
    expect(process.env["INTASEND_WEBHOOK_CHALLENGE"]).toBeUndefined();
  });

  it("sends the API key with the STK push and the secret key as the bearer token", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", SECRET, USER);
    await saveGatewaySecret("INTASEND_PUBLISHABLE_KEY", PUBKEY, USER);
    fetchCalls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        fetchCalls.push({
          url,
          body: JSON.parse(init.body as string),
          auth: (init.headers as Record<string, string>)["Authorization"],
        });
        return new Response(
          JSON.stringify({ invoice: { invoice_id: "INV1", state: "PENDING", api_ref: "ref" } }),
          { status: 201 },
        );
      }),
    );
    await intasendStkPush({ amount: 50, phone: "254712345678", reference: "ref" });
    expect(fetchCalls[0].auth).toBe(`Bearer ${SECRET}`);
    expect(fetchCalls[0].body).toMatchObject({
      public_key: PUBKEY,
      phone_number: "254712345678",
      api_ref: "ref",
    });
  });

  it("omits public_key when no API key is saved", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", SECRET, USER);
    fetchCalls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        fetchCalls.push({ url, body: JSON.parse(init.body as string), auth: "" });
        return new Response(
          JSON.stringify({ invoice: { invoice_id: "INV1", state: "PENDING", api_ref: "ref" } }),
          { status: 201 },
        );
      }),
    );
    await intasendStkPush({ amount: 50, phone: "254712345678", reference: "ref" });
    expect(fetchCalls[0].body).not.toHaveProperty("public_key");
  });
});

describe("sweep confirms payments without a webhook", () => {
  beforeEach(async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", SECRET, USER);
  });

  it("settles a paid payment, issues exactly one voucher, and leaves unpaid ones pending", async () => {
    setup([pay(P1), pay(P2)]);
    intasendStub({ [`INV-${P1}`]: { state: "COMPLETE" }, [`INV-${P2}`]: { state: "PENDING" } });
    const r = await sweepPendingIntasendPayments();
    expect(r).toMatchObject({ checked: 2, settled: 1, failed: 0, errors: 0 });
    const rows = h.db.rows("payments");
    expect(rows.find((x) => x.id === P1)).toMatchObject({ status: "success" });
    expect(rows.find((x) => x.id === P1)!.voucher_code).toBeTruthy();
    expect(rows.find((x) => x.id === P2)!.status).toBe("pending");
    expect(h.db.rows("vouchers")).toHaveLength(1);
    // it authenticated with the dashboard secret key
    expect(fetchCalls.every((c) => c.auth === `Bearer ${SECRET}`)).toBe(true);
  });

  it("running it again does not issue a second voucher", async () => {
    setup([pay(P1)]);
    intasendStub({ [`INV-${P1}`]: { state: "COMPLETE" } });
    await sweepPendingIntasendPayments();
    await sweepPendingIntasendPayments();
    expect(h.db.rows("vouchers")).toHaveLength(1);
  });

  it("marks a payment IntaSend reports as failed", async () => {
    setup([pay(P1)]);
    intasendStub({ [`INV-${P1}`]: { state: "FAILED" } });
    const r = await sweepPendingIntasendPayments();
    expect(r.failed).toBe(1);
    expect(h.db.rows("payments")[0].status).toBe("failed");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("does NOT release a voucher when the paid amount does not match", async () => {
    setup([pay(P1, { amount: 100 })]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    intasendStub({ [`INV-${P1}`]: { state: "COMPLETE", amount: 5 } });
    const r = await sweepPendingIntasendPayments();
    expect(r.settled).toBe(0);
    expect(h.db.rows("payments")[0].status).toBe("pending");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("only looks at recent, old-enough, IntaSend, pending payments", async () => {
    setup([
      pay(P1, { created_at: ago(5) }), // too new: customer is probably still entering their PIN
      pay(P2, { created_at: ago(3 * 86400) }), // too old to matter
      pay(P3, { provider: "payhero" }), // another gateway
      pay("aaaaaaaa-0000-4000-8000-000000000004", { status: "success" }), // already done
      pay("aaaaaaaa-0000-4000-8000-000000000005", { merchant_request_id: null }), // prompt never started
    ]);
    intasendStub({});
    const r = await sweepPendingIntasendPayments();
    expect(r.checked).toBe(0);
    expect(fetchCalls).toHaveLength(0);
  });

  it("checks oldest first and respects the limit", async () => {
    setup([
      pay(P1, { created_at: ago(300) }),
      pay(P2, { created_at: ago(200) }),
      pay(P3, { created_at: ago(100) }),
    ]);
    intasendStub({});
    const r = await sweepPendingIntasendPayments({ limit: 2 });
    expect(r.checked).toBe(2);
    expect(fetchCalls.map((c) => c.body.invoice_id)).toEqual([`INV-${P1}`, `INV-${P2}`]);
  });

  it("one failing IntaSend call does not stop the rest", async () => {
    setup([pay(P1, { created_at: ago(300) }), pay(P2, { created_at: ago(200) })]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    intasendStub({ [`INV-${P1}`]: 503, [`INV-${P2}`]: { state: "COMPLETE" } });
    const r = await sweepPendingIntasendPayments();
    expect(r).toMatchObject({ checked: 2, settled: 1, errors: 1 });
  });

  it("does nothing when IntaSend is not configured", async () => {
    setup([pay(P1)]);
    h.db.tables["platform_gateway_secrets"] = [];
    resetGatewaySecretCache();
    intasendStub({});
    expect((await sweepPendingIntasendPayments()).checked).toBe(0);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("background trigger", () => {
  it("is throttled: a burst of heartbeats checks IntaSend once", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", SECRET, USER);
    setup([pay(P1)]);
    intasendStub({ [`INV-${P1}`]: { state: "PENDING" } });
    await sweepIntasendIfDue();
    await sweepIntasendIfDue();
    await sweepIntasendIfDue();
    expect(fetchCalls).toHaveLength(1);
  });

  it("never throws, even if IntaSend is down", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", SECRET, USER);
    setup([pay(P1)]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    await expect(sweepIntasendIfDue()).resolves.toBeUndefined();
  });

  it("a router heartbeat triggers it and still answers ok", async () => {
    const TOKEN = "legacytoken".padEnd(32, "y");
    h.db = new FakeDb()
      .seed("platform_gateway_secrets", [])
      .seed("tenants", [{ id: T, slug: "acme", name: "Acme" }])
      .seed("routers", [
        {
          id: "r1000000-0000-0000-0000-000000000001",
          tenant_id: T,
          name: "Tower",
          status: "offline",
          provision_token: TOKEN,
          provision_token_expires_at: null,
          legacy_token_auth: true,
        },
      ])
      .seed("payments", [pay(P1)])
      .seed("vouchers", [])
      .seed("packages", [{ id: PKG, kind: "hotspot", duration_value: 1, duration_unit: "days" }]);
    await saveGatewaySecret("INTASEND_SECRET_KEY", SECRET, USER);
    resetGatewaySecretCache();
    resetSweepThrottle();
    intasendStub({ [`INV-${P1}`]: { state: "COMPLETE" } });
    const res = await call(Heartbeat, "GET", {
      url: "https://portal.test/hb?cpu=5",
      params: { token: TOKEN },
      ip: freshIp(),
    });
    expect(res.status).toBe(200);
    expect(h.db.rows("payments").find((x) => x.id === P1)!.status).toBe("success");
  });
});

describe("credential checks", () => {
  it("accepts a matching test pair", () => {
    expect(checkIntasendCredentials({ secretKey: SECRET, publishableKey: PUBKEY })).toBeNull();
  });
  it("rejects a test secret key with a live API key", () => {
    expect(
      checkIntasendCredentials({
        secretKey: SECRET,
        publishableKey: "ISPubKey_live_publicpublic00002",
      }),
    ).toMatch(/test key but your API key is a live/);
  });
  it("checks one changed key against the one already saved", () => {
    expect(
      checkIntasendCredentials(
        { publishableKey: "ISPubKey_live_publicpublic00002" },
        { secretKey: SECRET },
      ),
    ).toMatch(/test key but your API key is a live/);
    expect(checkIntasendCredentials({ publishableKey: PUBKEY }, { secretKey: SECRET })).toBeNull();
  });
  it("rejects the wrong kind of key in each box", () => {
    expect(checkIntasendCredentials({ secretKey: PUBKEY })).toMatch(/secret key/);
    expect(checkIntasendCredentials({ publishableKey: SECRET })).toMatch(/API \(publishable\) key/);
    expect(checkIntasendCredentials({ secretKey: "nonsense" })).toMatch(/secret key/);
  });
  it("validates the optional webhook challenge only when given", () => {
    expect(checkIntasendCredentials({ secretKey: SECRET })).toBeNull();
    expect(checkIntasendCredentials({ webhookChallenge: "short" })).toMatch(/12 to 128/);
    expect(checkIntasendCredentials({ webhookChallenge: "a-proper-long-challenge" })).toBeNull();
  });
});
