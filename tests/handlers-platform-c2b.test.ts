import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import { Route as ConfirmationRoute } from "@/routes/api/public/mpesa/platform-c2b.$token";
import { Route as ValidationRoute } from "@/routes/api/public/mpesa/platform-c2b-validation.$token";

const TOKEN = "private-callback-token";

const transaction = {
  TransID: "QAB123XYZ",
  TransTime: "20261107100000",
  TransAmount: "18.00",
  BusinessShortCode: "123456",
  BillRefNumber: "NG1234567890AB",
  FirstName: "Jane",
};

const sendConfirmation = (body: unknown = transaction, token = TOKEN, shortcode = "123456") =>
  call(ConfirmationRoute, "POST", {
    params: { token },
    body: { ...((body ?? {}) as object), BusinessShortCode: shortcode },
  });

beforeEach(() => {
  h.db = new FakeDb().seed("platform_mpesa_config", [
    { id: 1, shortcode: "123456", c2b_callback_token: TOKEN },
  ]);
  h.db.rpcs.record_platform_c2b_transaction = () => ({ data: "matched" });
});

afterEach(() => vi.restoreAllMocks());

describe("platform invoice C2B callbacks", () => {
  it("records a valid receipt and returns a successful callback response", async () => {
    const response = await sendConfirmation();

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      ResultCode: 0,
      ResultDesc: "Invoice payment matched",
    });
    expect(
      h.db.log.find((entry) => entry.op === "record_platform_c2b_transaction")?.payload,
    ).toMatchObject({
      p_transaction_id: "QAB123XYZ",
      p_shortcode: "123456",
      p_bill_ref_number: "NG1234567890AB",
      p_amount: 18,
    });
  });

  it("rejects callbacks with an invalid token or shortcode", async () => {
    const badToken = await sendConfirmation(transaction, "wrong-token");
    const badShortcode = await sendConfirmation(transaction, TOKEN, "654321");

    expect(badToken.status).toBe(404);
    expect(badShortcode.status).toBe(404);
    expect(h.db.log.some((entry) => entry.op === "record_platform_c2b_transaction")).toBe(false);
  });

  it("rejects invalid transaction details before recording", async () => {
    const response = await sendConfirmation({ ...transaction, TransAmount: "0" });

    expect(response.status).toBe(400);
    expect(h.db.log.some((entry) => entry.op === "record_platform_c2b_transaction")).toBe(false);
  });

  it("acks a valid Safaricom validation callback only for the registered token", async () => {
    const response = await call(ValidationRoute, "POST", { params: { token: TOKEN }, body: {} });
    const badToken = await call(ValidationRoute, "POST", {
      params: { token: "wrong-token" },
      body: {},
    });

    expect(await json(response)).toMatchObject({ ResultCode: 0 });
    expect(badToken.status).toBe(404);
  });

  it("asks Safaricom to retry if the transaction cannot be recorded", async () => {
    h.db.failNext("rpc", "record_platform_c2b_transaction");

    const response = await sendConfirmation();

    expect(response.status).toBe(503);
  });
});
