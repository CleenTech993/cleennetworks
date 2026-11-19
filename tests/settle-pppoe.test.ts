import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type Row } from "./helpers/fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as { from: (table: string) => unknown; tables: Record<string, Row[]> },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => h.db.from(table) },
}));

import { settlePayment } from "../src/lib/payment-settle.server";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const CUSTOMER = "bbbbbbbb-0000-0000-0000-000000000001";
const PACKAGE = "cccccccc-0000-0000-0000-000000000001";
const PAYMENT = "dddddddd-0000-0000-0000-000000000001";
const DAY = 86_400_000;

function seed(customerExpiry: string | null, paymentExpiry: string | null = null) {
  h.db = makeDb({
    payments: [
      {
        id: PAYMENT,
        tenant_id: TENANT,
        customer_id: CUSTOMER,
        package_id: PACKAGE,
        phone: "254712345678",
        tv_device_id: null,
        status: "pending",
        expires_at: paymentExpiry,
      },
    ],
    packages: [{ id: PACKAGE, kind: "pppoe", duration_value: 30, duration_unit: "days" }],
    customers: [
      {
        id: CUSTOMER,
        tenant_id: TENANT,
        customer_type: "pppoe",
        status: "expired",
        package_id: PACKAGE,
        expires_at: customerExpiry,
      },
    ],
  });
}

const settle = (expires_at: string | null = null) =>
  settlePayment({
    payment: {
      id: PAYMENT,
      tenant_id: TENANT,
      customer_id: CUSTOMER,
      package_id: PACKAGE,
      phone: "254712345678",
      tv_device_id: null,
      expires_at,
    },
    receipt: "RCP123",
    raw: {},
  });

beforeEach(() => vi.useRealTimers());

describe("settlePayment for PPPoE packages", () => {
  it("renews the customer's subscription after confirmed payment", async () => {
    const currentExpiry = new Date(Date.now() + 5 * DAY).toISOString();
    seed(currentExpiry);

    expect(await settle()).toBe("settled");

    const customer = h.db.tables.customers[0]!;
    expect(customer.status).toBe("active");
    expect(customer.package_id).toBe(PACKAGE);
    const remainingDays = (new Date(customer.expires_at as string).getTime() - Date.now()) / DAY;
    expect(remainingDays).toBeGreaterThan(34.9);
    expect(remainingDays).toBeLessThan(35.1);
    expect(h.db.tables.payments[0]).toMatchObject({
      status: "success",
      customer_id: CUSTOMER,
      voucher_code: null,
    });
  });

  it("reuses the saved expiry when settlement is retried", async () => {
    seed(null);
    await settle();
    const firstExpiry = h.db.tables.customers[0]!.expires_at;

    h.db.tables.payments[0]!.status = "pending";
    await settle(h.db.tables.payments[0]!.expires_at as string);

    expect(h.db.tables.customers[0]!.expires_at).toBe(firstExpiry);
  });
});
