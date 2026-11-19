import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type Row } from "./helpers/fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as { from: (table: string) => unknown; tables: Record<string, Row[]> },
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => h.db.from(table),
    rpc: (name: string, args: unknown) => h.rpc(name, args),
  },
}));

import { settlePayment } from "../src/lib/payment-settle.server";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const CUSTOMER = "bbbbbbbb-0000-0000-0000-000000000001";
const PACKAGE = "cccccccc-0000-0000-0000-000000000001";
const PAYMENT = "dddddddd-0000-0000-0000-000000000001";
const INVOICE = "eeeeeeee-0000-0000-0000-000000000001";

beforeEach(() => {
  h.db = makeDb({
    payments: [
      {
        id: PAYMENT,
        tenant_id: TENANT,
        customer_id: CUSTOMER,
        package_id: PACKAGE,
        customer_invoice_id: INVOICE,
        phone: "254712345678",
        tv_device_id: null,
        status: "pending",
        expires_at: null,
      },
    ],
    customers: [
      {
        id: CUSTOMER,
        tenant_id: TENANT,
        customer_type: "pppoe",
        status: "active",
      },
    ],
    packages: [{ id: PACKAGE, kind: "pppoe", duration_value: 30, duration_unit: "days" }],
  });
  h.rpc.mockReset().mockResolvedValue({ data: true, error: null });
});

describe("settling PPPoE invoice payments", () => {
  it("uses the atomic database settlement instead of updating entitlements separately", async () => {
    const result = await settlePayment({
      payment: {
        id: PAYMENT,
        tenant_id: TENANT,
        customer_id: CUSTOMER,
        package_id: PACKAGE,
        customer_invoice_id: INVOICE,
        phone: "254712345678",
        tv_device_id: null,
        expires_at: null,
      },
      receipt: "RCP123",
      raw: { ResultCode: 0 },
    });

    expect(result).toBe("settled");
    expect(h.rpc).toHaveBeenCalledWith("finalize_customer_invoice_payment", {
      p_payment_id: PAYMENT,
      p_receipt: "RCP123",
      p_raw_callback: { ResultCode: 0 },
    });
    expect(h.db.tables.customers[0]).not.toHaveProperty("expires_at");
  });

  it("releases the payment claim if invoice settlement fails", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Invoice already paid" } });

    await expect(
      settlePayment({
        payment: {
          id: PAYMENT,
          tenant_id: TENANT,
          customer_id: CUSTOMER,
          package_id: PACKAGE,
          customer_invoice_id: INVOICE,
          phone: "254712345678",
          tv_device_id: null,
          expires_at: null,
        },
        receipt: "RCP123",
        raw: {},
      }),
    ).rejects.toThrow("Invoice already paid");

    expect(h.db.tables.payments[0]?.status).toBe("pending");
  });
});
