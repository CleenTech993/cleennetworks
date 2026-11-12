import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { h } from "./helpers/setup";

const darajaMock = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@/lib/daraja.server", () => ({ startDarajaStkPush: darajaMock.start }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => "portal.test" }));

import { Route as AccountRoute } from "@/routes/api/public/pppoe-portal.$slug.account";
import { Route as CheckoutRoute } from "@/routes/api/public/pppoe-portal.$slug.checkout";
import { Route as LoginRoute } from "@/routes/api/public/pppoe-portal.$slug.login";
import { Route as LogoutRoute } from "@/routes/api/public/pppoe-portal.$slug.logout";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const PACKAGE = "33333333-3333-4333-8333-333333333333";
const INVOICE = "44444444-4444-4444-8444-444444444444";
const USERNAME = "home-123";
const PASSWORD = "router-secret";
const PARAMS = { slug: "acme" };
let originalServiceKey: string | undefined;

beforeEach(() => {
  originalServiceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-portal-session-key";
  darajaMock.start.mockReset().mockResolvedValue({
    checkoutRequestId: "ws_CO_test",
    merchantRequestId: "merchant-test",
  });
  h.db = new FakeDb()
    .seed("tenants", [
      {
        id: TENANT,
        slug: "acme",
        name: "Acme ISP",
        status: "active",
        billing_suspended_at: null,
        primary_color: "#123456",
        support_phone: "0712345678",
        support_email: "help@example.test",
      },
    ])
    .seed("customers", [
      {
        id: CUSTOMER,
        tenant_id: TENANT,
        customer_type: "pppoe",
        pppoe_username: USERNAME,
        pppoe_password: PASSWORD,
        full_name: "Test Customer",
        phone: "0712345678",
        status: "expired",
        expires_at: "2026-10-01T00:00:00Z",
        package_id: PACKAGE,
        last_ip: "192.0.2.3",
        last_seen_at: "2026-10-01T00:00:00Z",
        usage_bytes_in: 1000,
        usage_bytes_out: 2000,
      },
    ])
    .seed("packages", [
      {
        id: PACKAGE,
        tenant_id: TENANT,
        kind: "pppoe",
        name: "Home 10 Mbps",
        description: "Monthly broadband",
        price: 1500,
        active: true,
        duration_value: 30,
        duration_unit: "days",
        download_kbps: 10000,
        upload_kbps: 2000,
      },
    ]);
});

afterEach(() => {
  if (originalServiceKey === undefined) delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  else process.env["SUPABASE_SERVICE_ROLE_KEY"] = originalServiceKey;
  vi.restoreAllMocks();
});

async function login() {
  return call(LoginRoute, "POST", {
    body: { username: USERNAME, password: PASSWORD },
    params: PARAMS,
    ip: "192.0.2.20",
  });
}

describe("PPPoE customer portal", () => {
  it("authenticates PPPoE credentials with a scoped secure session cookie", async () => {
    const response = await login();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("/api/public/pppoe-portal/acme/");
  });

  it("rejects invalid credentials without revealing whether the username exists", async () => {
    const response = await call(LoginRoute, "POST", {
      body: { username: USERNAME, password: "wrong-password" },
      params: PARAMS,
      ip: "192.0.2.21",
    });

    expect(response.status).toBe(401);
    expect(await json(response)).toMatchObject({ error: "The username or password is incorrect." });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns only the signed-in customer's account and payment information", async () => {
    const signedIn = await login();
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0];
    const response = await call(AccountRoute, "GET", {
      params: PARAMS,
      headers: { cookie },
    });
    const result = await json(response);

    expect(response.status).toBe(200);
    expect(result.customer).toMatchObject({
      full_name: "Test Customer",
      pppoe_username: USERNAME,
      status: "expired",
    });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(result.packages).toMatchObject([{ id: PACKAGE, name: "Home 10 Mbps" }]);
  });

  it("binds the session to its tenant slug and refuses anonymous access", async () => {
    const anonymous = await call(AccountRoute, "GET", { params: PARAMS });
    expect(anonymous.status).toBe(401);

    const signedIn = await login();
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0];
    const otherTenant = await call(AccountRoute, "GET", {
      params: { slug: "other-tenant" },
      headers: { cookie },
    });
    expect(otherTenant.status).toBe(401);
  });

  it("lets an authenticated expired customer renew through M-Pesa", async () => {
    const signedIn = await login();
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0];
    const response = await call(CheckoutRoute, "POST", {
      body: { packageId: PACKAGE },
      params: PARAMS,
      headers: { cookie },
      ip: "192.0.2.22",
    });
    const result = await json(response);

    expect(response.status).toBe(200);
    expect(h.db.rows("payments")).toMatchObject([
      {
        customer_id: CUSTOMER,
        package_id: PACKAGE,
        phone: "254712345678",
        status: "pending",
      },
    ]);
    expect(darajaMock.start).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, paymentId: result.paymentId, amount: 1500 }),
    );
  });

  it("uses the invoice snapshot amount when the package price has changed", async () => {
    h.db.seed("customer_invoices", [
      {
        id: INVOICE,
        tenant_id: TENANT,
        customer_id: CUSTOMER,
        package_id: PACKAGE,
        amount: 1700,
        status: "pending",
        issued_at: "2026-10-01T00:00:00Z",
      },
    ]);
    const signedIn = await login();
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0];
    const response = await call(CheckoutRoute, "POST", {
      body: { packageId: PACKAGE },
      params: PARAMS,
      headers: { cookie },
      ip: "192.0.2.23",
    });

    expect(response.status).toBe(200);
    expect(h.db.rows("payments")).toMatchObject([
      {
        customer_invoice_id: INVOICE,
        amount: 1700,
        package_id: PACKAGE,
      },
    ]);
    expect(darajaMock.start).toHaveBeenCalledWith(expect.objectContaining({ amount: 1700 }));
  });

  it("does not start a duplicate prompt while an invoice payment is processing", async () => {
    h.db.seed("customer_invoices", [
      {
        id: INVOICE,
        tenant_id: TENANT,
        customer_id: CUSTOMER,
        package_id: PACKAGE,
        amount: 1500,
        status: "pending",
        issued_at: "2026-10-01T00:00:00Z",
      },
    ]);
    h.db.seed("payments", [
      {
        id: "55555555-5555-4555-8555-555555555555",
        tenant_id: TENANT,
        customer_id: CUSTOMER,
        package_id: PACKAGE,
        customer_invoice_id: INVOICE,
        status: "processing",
        created_at: new Date().toISOString(),
      },
    ]);
    const signedIn = await login();
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0];
    const response = await call(CheckoutRoute, "POST", {
      body: { packageId: PACKAGE },
      params: PARAMS,
      headers: { cookie },
      ip: "192.0.2.24",
    });

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      paymentId: "55555555-5555-4555-8555-555555555555",
    });
    expect(h.db.rows("payments")).toHaveLength(1);
    expect(darajaMock.start).not.toHaveBeenCalled();
  });

  it("clears the session cookie on sign out", async () => {
    const response = await call(LogoutRoute, "POST", { params: PARAMS });

    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).toContain("/api/public/pppoe-portal/acme/");
  });
});
