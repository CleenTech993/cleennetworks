// Smart-TV payments are settled by the shared settlePayment() so PayHero and IntaSend both support them.
// A TV payment extends the device's access (never mints a voucher) and must be safe to retry.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type Row } from "./helpers/fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as { from: (t: string) => unknown; tables: Record<string, Row[]> },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => h.db.from(t) },
}));

import { settlePayment } from "../src/lib/payment-settle.server";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const PKG = "dddddddd-0000-0000-0000-000000000001";
const TV = "eeeeeeee-0000-0000-0000-000000000001";
const PAY = "3f9a1c2b-0000-4000-8000-000000000001";
const DAY = 86_400_000;

function seed(tvStatus: string, tvExpires: string | null, payExpires: string | null = null) {
  h.db = makeDb({
    payments: [
      {
        id: PAY,
        tenant_id: TENANT,
        package_id: PKG,
        status: "pending",
        expires_at: payExpires,
        voucher_code: null,
      },
    ],
    packages: [{ id: PKG, kind: "hotspot", duration_value: 7, duration_unit: "days" }],
    tv_devices: [
      { id: TV, tenant_id: TENANT, status: tvStatus, expires_at: tvExpires, package_id: null },
    ],
  });
}
const settle = (expires_at: string | null = null) =>
  settlePayment({
    payment: {
      id: PAY,
      tenant_id: TENANT,
      package_id: PKG,
      phone: "254712345678",
      tv_device_id: TV,
      expires_at,
    },
    receipt: "RCP123",
    raw: {},
  });

beforeEach(() => vi.useRealTimers());

describe("settlePayment for a smart TV", () => {
  it("activates the TV for the package duration and issues no voucher", async () => {
    seed("expired", new Date(Date.now() - DAY).toISOString());
    expect(await settle()).toBe("settled");
    const tv = h.db.tables.tv_devices[0];
    expect(tv.status).toBe("active");
    const days = (new Date(tv.expires_at as string).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(tv.package_id).toBe(PKG);
    expect(h.db.tables.vouchers).toHaveLength(0);
    expect(h.db.tables.payments[0]).toMatchObject({
      status: "success",
      mpesa_receipt: "RCP123",
      voucher_code: null,
    });
  });

  it("renewing early adds the time on top of the remaining access", async () => {
    const current = new Date(Date.now() + 3 * DAY).toISOString();
    seed("active", current);
    await settle();
    const days =
      (new Date(h.db.tables.tv_devices[0].expires_at as string).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(9.9); // 3 days left + 7 days bought
    expect(days).toBeLessThan(10.1);
  });

  it("a retry reuses the saved expiry instead of extending the TV a second time", async () => {
    seed("expired", null);
    await settle();
    const first = h.db.tables.tv_devices[0].expires_at as string;
    // Gateway retry after a crash: payment was released back to pending but kept its expiry.
    h.db.tables.payments[0].status = "pending";
    await settle(h.db.tables.payments[0].expires_at as string);
    expect(h.db.tables.tv_devices[0].expires_at).toBe(first);
  });

  it("never re-activates a blocked TV, but the payment is still recorded", async () => {
    seed("blocked", null);
    await settle();
    expect(h.db.tables.tv_devices[0].status).toBe("blocked");
    expect(h.db.tables.payments[0].status).toBe("success");
  });

  it("releases the claim if the TV does not exist, so the gateway can retry", async () => {
    seed("active", null);
    h.db.tables.tv_devices.length = 0;
    await expect(settle()).rejects.toThrow("TV device not found");
    expect(h.db.tables.payments[0].status).toBe("pending");
  });
});
