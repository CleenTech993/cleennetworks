import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@/lib/daraja.server", () => ({
  queryDarajaStkPush: vi.fn(),
}));
import { queryDarajaStkPush } from "@/lib/daraja.server";
import { Route } from "@/routes/api/public/portal/$slug/payment-status";

const TENANT = "11111111-1111-1111-1111-111111111111";
const PACKAGE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let paymentId = "";
let sequence = 0;

const readStatus = () =>
  call(Route, "GET", {
    url: `https://portal.test/payment-status?id=${paymentId}`,
    params: { slug: "tenant" },
    ip: freshIp(),
  });

beforeEach(() => {
  paymentId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12, "0")}`;
  h.db = new FakeDb()
    .seed("tenants", [{ id: TENANT, slug: "tenant" }])
    .seed("packages", [
      {
        id: PACKAGE,
        tenant_id: TENANT,
        kind: "hotspot",
        duration_value: 2,
        duration_unit: "hours",
      },
    ])
    .seed("payments", [
      {
        id: paymentId,
        tenant_id: TENANT,
        package_id: PACKAGE,
        phone: "254712345678",
        amount: 50,
        status: "pending",
        provider: "daraja",
        checkout_request_id: "ws_CO_test",
        tv_device_id: null,
        expires_at: null,
        mpesa_receipt: null,
        voucher_code: null,
      },
    ]);
  vi.mocked(queryDarajaStkPush).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("public portal payment status", () => {
  it("settles a pending payment only after Daraja confirms success", async () => {
    vi.mocked(queryDarajaStkPush).mockResolvedValue({
      resultCode: "0",
      resultDescription: "The service request is processed successfully.",
    });

    const response = await readStatus();

    expect(await json(response)).toMatchObject({
      status: "success",
      voucher_code: expect.any(String),
    });
    expect(h.db.rows("payments")[0]).toMatchObject({ status: "success", mpesa_receipt: null });
    expect(h.db.rows("vouchers")).toHaveLength(1);
    expect(queryDarajaStkPush).toHaveBeenCalledWith(TENANT, "ws_CO_test");
  });

  it("leaves a payment pending when Daraja has not returned a result", async () => {
    vi.mocked(queryDarajaStkPush).mockResolvedValue({
      resultCode: null,
      resultDescription: "Request is still being processed.",
    });

    const response = await readStatus();

    expect(await json(response)).toMatchObject({ status: "pending" });
    expect(h.db.rows("payments")[0].status).toBe("pending");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("marks the payment failed when Daraja reports a terminal failure", async () => {
    vi.mocked(queryDarajaStkPush).mockResolvedValue({
      resultCode: "1032",
      resultDescription: "Request cancelled by user.",
    });

    const response = await readStatus();

    expect(await json(response)).toMatchObject({ status: "failed" });
    expect(h.db.rows("payments")[0].status).toBe("failed");
    expect(h.db.rows("vouchers")).toHaveLength(0);
  });

  it("does not query or re-settle an already successful payment", async () => {
    h.db.rows("payments")[0].status = "success";
    h.db.rows("payments")[0].voucher_code = "EXISTING123";
    h.db.seed("vouchers", [
      { tenant_id: TENANT, package_id: PACKAGE, payment_id: paymentId, code: "EXISTING123" },
    ]);
    vi.mocked(queryDarajaStkPush).mockResolvedValue({
      resultCode: "0",
      resultDescription: "Success",
    });

    await readStatus();
    await readStatus();

    expect(queryDarajaStkPush).not.toHaveBeenCalled();
    expect(h.db.rows("vouchers")).toHaveLength(1);
    expect(h.db.rows("payments")[0].mpesa_receipt).toBeNull();
  });
});
