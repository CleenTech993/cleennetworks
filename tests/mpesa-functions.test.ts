import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { h } from "./helpers/setup";

const startStk = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: () => ({
      validator: () => ({
        handler: (handler: (args: unknown) => unknown) => handler,
      }),
    }),
  }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHost: () => "tenant.example.test",
}));
vi.mock("@/lib/require-aal2", () => ({ requireSupabaseAal2: vi.fn() }));
vi.mock("@/lib/daraja.server", () => ({ startDarajaStkPush: startStk.start }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import { initiateStkPushTenant } from "@/lib/mpesa.functions";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "99999999-9999-9999-9999-999999999999";
const PACKAGE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CUSTOMER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const initiate = (customerId: string) =>
  initiateStkPushTenant({
    data: { packageId: PACKAGE, phone: "0712345678", customerId },
    context: { supabase: h.db },
  } as never);

beforeEach(() => {
  h.db = new FakeDb()
    .seed("profiles", [{ id: "staff", tenant_id: TENANT }])
    .seed("tenants", [{ id: TENANT, name: "Test Tenant" }])
    .seed("packages", [
      { id: PACKAGE, tenant_id: TENANT, name: "PPPoE", kind: "pppoe", price: 100 },
    ]);
  startStk.start.mockReset().mockResolvedValue({
    checkoutRequestId: "checkout-1",
    merchantRequestId: "merchant-1",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("initiateStkPushTenant customer ownership", () => {
  it("rejects a customer from another tenant before creating a payment or starting STK", async () => {
    h.db.seed("customers", [{ id: CUSTOMER, tenant_id: OTHER_TENANT, customer_type: "pppoe" }]);

    await expect(initiate(CUSTOMER)).rejects.toThrow("Customer not found.");

    expect(h.db.rows("payments")).toHaveLength(0);
    expect(startStk.start).not.toHaveBeenCalled();
  });

  it("rejects a customer lookup failure before creating a payment", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    h.db.failNext("customers", "select", "database unavailable");

    await expect(initiate(CUSTOMER)).rejects.toThrow("Could not verify the customer account.");

    expect(logError).toHaveBeenCalledWith(
      "Could not verify STK customer ownership",
      expect.objectContaining({ message: "database unavailable" }),
    );
    expect(h.db.rows("payments")).toHaveLength(0);
    expect(startStk.start).not.toHaveBeenCalled();
  });

  it("allows an owned PPPoE customer to start payment", async () => {
    h.db.seed("customers", [{ id: CUSTOMER, tenant_id: TENANT, customer_type: "pppoe" }]);

    await initiate(CUSTOMER);

    expect(h.db.rows("payments")).toHaveLength(1);
    expect(h.db.rows("payments")[0]).toMatchObject({
      tenant_id: TENANT,
      customer_id: CUSTOMER,
      package_id: PACKAGE,
    });
    expect(startStk.start).toHaveBeenCalledOnce();
  });
});
