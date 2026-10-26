// End-to-end behaviour of the IntaSend payment flow with an in-memory database and a mocked IntaSend API:
// webhook -> status check -> voucher. Run against the real reconcile / settle / webhook code.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type Row } from "./helpers/fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as { from: (t: string) => unknown; tables: Record<string, Row[]> },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => h.db.from(t) },
}));

const PAY = "3f9a1c2b-0000-4000-8000-000000000001";
const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const PKG = "dddddddd-0000-0000-0000-000000000001";

const seed = (over: Row = {}) => ({
  payments: [
    {
      id: PAY,
      tenant_id: TENANT,
      package_id: PKG,
      phone: "254712345678",
      amount: 100,
      status: "pending",
      provider: "intasend",
      merchant_request_id: "INV1",
      mpesa_receipt: null,
      voucher_code: null,
      ...over,
    },
  ],
  packages: [{ id: PKG, kind: "hotspot", duration_value: 1, duration_unit: "days" }],
});

const invoice = (over: Row = {}) => ({
  invoice: {
    invoice_id: "INV1",
    state: "COMPLETE",
    provider: "M-PESA",
    value: 100,
    currency: "KES",
    account: "254712345678",
    api_ref: PAY,
    provider_ref: "RCPT123",
    failed_reason: null,
    failed_code: null,
    ...over,
  },
});

let calls: { url: string; init: RequestInit }[] = [];
function intasendReplies(...replies: { status?: number; body: unknown }[]) {
  calls = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = replies[Math.min(i++, replies.length - 1)];
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
}

beforeEach(() => {
  process.env["INTASEND_SECRET_KEY"] = "ISSecretKey_test_abc";
  process.env["INTASEND_WEBHOOK_CHALLENGE"] = "the-challenge";
  h.db = makeDb(seed());
  calls = [];
});

const pay = () => h.db.tables.payments[0];
const reconcile = async (id = PAY) =>
  (await import("../src/lib/intasend-reconcile.server")).reconcileIntasendPayment(id);

describe("reconcileIntasendPayment", () => {
  it("verifies with IntaSend, then issues exactly one voucher and records the receipt", async () => {
    intasendReplies({ body: invoice() });
    expect(await reconcile()).toEqual({ status: "success" });

    expect(pay()).toMatchObject({ status: "success", mpesa_receipt: "RCPT123" });
    expect(h.db.tables.vouchers).toHaveLength(1);
    expect(h.db.tables.vouchers[0]).toMatchObject({
      tenant_id: TENANT,
      package_id: PKG,
      payment_id: PAY,
    });
    expect(pay().voucher_code).toBe(h.db.tables.vouchers[0].code);
    expect(pay().expires_at).toBeTruthy();

    // it asked IntaSend (server-side, with the secret key) rather than trusting anything it was told
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://sandbox.intasend.com/api/v1/payment/status/");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer ISSecretKey_test_abc",
    );
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ invoice_id: "INV1" });
  });

  it("a replayed or concurrent event never issues a second voucher", async () => {
    intasendReplies({ body: invoice() });
    await Promise.all([reconcile(), reconcile(), reconcile()]);
    await reconcile();
    expect(h.db.tables.vouchers).toHaveLength(1);
    expect(pay().status).toBe("success");
  });

  it("does nothing, and does not even call IntaSend, once the payment is already paid", async () => {
    h.db = makeDb(seed({ status: "success" }));
    intasendReplies({ body: invoice() });
    expect(await reconcile()).toEqual({ status: "success" });
    expect(calls).toHaveLength(0);
  });

  it("ignores payments that belong to another gateway", async () => {
    h.db = makeDb(seed({ provider: "payhero" }));
    intasendReplies({ body: invoice() });
    expect(await reconcile()).toEqual({ status: "pending" });
    expect(calls).toHaveLength(0);
    expect(h.db.tables.vouchers).toHaveLength(0);
  });

  it("refuses to release a voucher when the paid invoice points at a different payment", async () => {
    intasendReplies({ body: invoice({ api_ref: "11111111-2222-4333-8444-555555555555" }) });
    expect(await reconcile()).toEqual({ status: "pending" });
    expect(h.db.tables.vouchers).toHaveLength(0);
    expect(pay().status).toBe("pending");
  });

  it("refuses to release a voucher when the amount paid is too low", async () => {
    intasendReplies({ body: invoice({ value: 10 }) });
    await reconcile();
    expect(h.db.tables.vouchers).toHaveLength(0);
    expect(pay().status).toBe("pending");
  });

  it("keeps waiting while the customer is still paying", async () => {
    for (const state of ["PENDING", "PROCESSING", "RETRY", "PARTIAL"]) {
      intasendReplies({ body: invoice({ state }) });
      expect(await reconcile()).toEqual({ status: "pending" });
    }
    expect(h.db.tables.vouchers).toHaveLength(0);
  });

  it("records a failure, and still honours a later successful retry", async () => {
    intasendReplies({
      body: invoice({ state: "FAILED", failed_code: "1032", provider_ref: null }),
    });
    expect(await reconcile()).toEqual({ status: "failed" });
    expect(pay().status).toBe("failed");

    intasendReplies({ body: invoice() });
    expect(await reconcile()).toEqual({ status: "success" });
    expect(h.db.tables.vouchers).toHaveLength(1);
  });

  it("leaves the payment untouched when IntaSend cannot be reached", async () => {
    intasendReplies({ status: 500, body: { detail: "boom" } });
    await expect(reconcile()).rejects.toThrow(/IntaSend status failed/);
    expect(pay().status).toBe("pending");
    expect(h.db.tables.vouchers).toHaveLength(0);
  });
});

describe("IntaSend webhook route", () => {
  type Handler = (a: { request: Request }) => Promise<Response>;
  const post = async (body: unknown) => {
    const { Route } = await import("../src/routes/api/public/intasend/webhook");
    const handler = (Route.options as unknown as { server: { handlers: { POST: Handler } } }).server
      .handlers.POST;
    return handler({
      request: new Request("https://x.test/api/public/intasend/webhook", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    });
  };
  const event = (over: Row = {}) => ({
    topic: "collection_event",
    challenge: "the-challenge",
    invoice_id: "INV1",
    state: "COMPLETE",
    api_ref: PAY,
    value: "100.00",
    currency: "KES",
    ...over,
  });

  it("rejects a wrong or missing challenge before touching anything", async () => {
    intasendReplies({ body: invoice() });
    for (const challenge of ["nope", "", undefined]) {
      expect((await post(event({ challenge }))).status).toBe(401);
    }
    expect(calls).toHaveLength(0);
    expect(h.db.tables.vouchers).toHaveLength(0);
  });

  it("fails closed when the challenge secret is not configured", async () => {
    delete process.env["INTASEND_WEBHOOK_CHALLENGE"];
    expect((await post(event())).status).toBe(503);
  });

  it("ignores other event types and unknown references", async () => {
    intasendReplies({ body: invoice() });
    expect((await post(event({ topic: "send_money_event" }))).status).toBe(200);
    expect((await post(event({ api_ref: "not-a-uuid" }))).status).toBe(200);
    expect((await post(event({ api_ref: "11111111-2222-4333-8444-555555555555" }))).status).toBe(
      200,
    );
    expect(calls).toHaveLength(0);
  });

  it("ignores an event whose invoice is not the one created for the payment", async () => {
    intasendReplies({ body: invoice() });
    const res = await post(event({ invoice_id: "SOMEONE-ELSES" }));
    expect(await res.json()).toMatchObject({ note: "Invoice mismatch" });
    expect(calls).toHaveLength(0);
  });

  it("a genuine event leads to a verified voucher, and a forged 'COMPLETE' does not", async () => {
    // Forged: valid challenge but IntaSend says the invoice is still unpaid.
    intasendReplies({ body: invoice({ state: "PROCESSING" }) });
    expect(await (await post(event())).json()).toMatchObject({ ok: true, status: "pending" });
    expect(h.db.tables.vouchers).toHaveLength(0);

    intasendReplies({ body: invoice() });
    expect(await (await post(event())).json()).toMatchObject({ ok: true, status: "success" });
    expect(h.db.tables.vouchers).toHaveLength(1);
  });

  it("returns 5xx when IntaSend cannot confirm, so the event can be replayed from the dashboard", async () => {
    intasendReplies({ status: 503, body: {} });
    expect((await post(event())).status).toBe(502);
    expect(pay().status).toBe("pending");
  });
});
