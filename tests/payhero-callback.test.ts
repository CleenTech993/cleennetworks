// The PayHero callback now settles payments through the shared settlePayment(); these tests make sure
// the existing PayHero behaviour (verify first, one voucher, replay-safe) survived that refactor.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type Row } from "./helpers/fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as { from: (t: string) => unknown; tables: Record<string, Row[]> },
  status: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => h.db.from(t) },
}));
vi.mock("@/lib/mpesa.server", async (orig) => ({
  ...(await orig<typeof import("../src/lib/mpesa.server")>()),
  payheroTransactionStatus: h.status,
}));

const PAY = "3f9a1c2b-0000-4000-8000-000000000001";
const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const PKG = "dddddddd-0000-0000-0000-000000000001";

beforeEach(() => {
  h.status.mockReset();
  h.db = makeDb({
    payments: [
      {
        id: PAY,
        tenant_id: TENANT,
        package_id: PKG,
        phone: "254712345678",
        amount: 100,
        status: "pending",
        provider: "payhero",
        merchant_request_id: "PH-REF",
        checkout_request_id: "CO1",
        mpesa_receipt: null,
        voucher_code: null,
      },
    ],
    packages: [{ id: PKG, kind: "hotspot", duration_value: 1, duration_unit: "days" }],
  });
});

type Handler = (a: { request: Request; params: { tenantId: string } }) => Promise<Response>;
const callback = async (body: unknown, tenantId = TENANT) => {
  const { Route } = await import("../src/routes/api/public/mpesa/callback.$tenantId");
  const handler = (Route.options as unknown as { server: { handlers: { POST: Handler } } }).server
    .handlers.POST;
  return handler({
    request: new Request("https://x.test/cb", { method: "POST", body: JSON.stringify(body) }),
    params: { tenantId },
  });
};
const event = {
  response: {
    ExternalReference: PAY,
    CheckoutRequestID: "CO1",
    MpesaReceiptNumber: "FORGED",
    Phone: "254700000000",
  },
};
const pay = () => h.db.tables.payments[0];

describe("PayHero callback", () => {
  it("trusts PayHero's own status, not the callback body: one voucher and PayHero's receipt", async () => {
    h.status.mockResolvedValue({ status: "SUCCESS", receipt: "REAL123", raw: {} });
    const res = await callback(event);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.status).toHaveBeenCalledWith("PH-REF");
    expect(pay()).toMatchObject({
      status: "success",
      mpesa_receipt: "REAL123",
      phone: "254712345678",
    });
    expect(h.db.tables.vouchers).toHaveLength(1);
    expect(pay().voucher_code).toBe(h.db.tables.vouchers[0].code);
  });

  it("a replayed or concurrent callback does not issue a second voucher", async () => {
    h.status.mockResolvedValue({ status: "SUCCESS", receipt: "REAL123", raw: {} });
    await Promise.all([callback(event), callback(event), callback(event)]);
    await callback(event);
    expect(h.db.tables.vouchers).toHaveLength(1);
  });

  it("a forged success callback does nothing when PayHero says it is not paid", async () => {
    h.status.mockResolvedValue({ status: "QUEUED", receipt: null, raw: {} });
    expect(await (await callback(event)).json()).toMatchObject({ note: "Pending" });
    expect(pay().status).toBe("pending");
    expect(h.db.tables.vouchers).toHaveLength(0);
  });

  it("records a PayHero failure", async () => {
    h.status.mockResolvedValue({ status: "FAILED", receipt: null, raw: {} });
    await callback(event);
    expect(pay().status).toBe("failed");
    expect(h.db.tables.vouchers).toHaveLength(0);
  });

  it("answers 502 (so PayHero retries) when it cannot verify", async () => {
    h.status.mockRejectedValue(new Error("down"));
    expect((await callback(event)).status).toBe(502);
    expect(pay().status).toBe("pending");
  });

  it("ignores a callback addressed to another tenant", async () => {
    h.status.mockResolvedValue({ status: "SUCCESS", receipt: "X", raw: {} });
    expect(
      await (await callback(event, "bbbbbbbb-0000-0000-0000-000000000009")).json(),
    ).toMatchObject({ note: "Unknown payment" });
    expect(h.db.tables.vouchers).toHaveLength(0);
  });
});
