import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import { Route } from "@/routes/api/public/mpesa/platform-stk.$token";

const TOKEN = "platform-stk-token";
const callback = {
  Body: {
    stkCallback: {
      CheckoutRequestID: "ws_CO_123456",
      ResultCode: 0,
      CallbackMetadata: {
        Item: [
          { Name: "Amount", Value: 18 },
          { Name: "MpesaReceiptNumber", Value: "QAB123XYZ" },
          { Name: "TransactionDate", Value: 20261107100000 },
          { Name: "PhoneNumber", Value: 254712345678 },
        ],
      },
    },
  },
};

beforeEach(() => {
  h.db = new FakeDb().seed("platform_mpesa_config", [
    { id: 1, shortcode: "123456", c2b_callback_token: TOKEN },
  ]);
  h.db.rpcs.record_platform_stk_transaction = () => ({ data: "matched" });
});

afterEach(() => vi.restoreAllMocks());

describe("platform Buy Goods STK callback", () => {
  it("records a successful prompt payment and reports success", async () => {
    const response = await call(Route, "POST", {
      params: { token: TOKEN },
      body: callback,
    });

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ ResultCode: 0 });
    expect(
      h.db.log.find((entry) => entry.op === "record_platform_stk_transaction")?.payload,
    ).toMatchObject({
      p_checkout_request_id: "ws_CO_123456",
      p_transaction_id: "QAB123XYZ",
      p_shortcode: "123456",
      p_amount: 18,
    });
  });

  it("rejects an invalid token and invalid successful callback metadata", async () => {
    const invalidToken = await call(Route, "POST", {
      params: { token: "wrong" },
      body: callback,
    });
    const invalidMetadata = await call(Route, "POST", {
      params: { token: TOKEN },
      body: {
        Body: {
          stkCallback: {
            ...callback.Body.stkCallback,
            CallbackMetadata: { Item: [{ Name: "Amount", Value: 0 }] },
          },
        },
      },
    });

    expect(invalidToken.status).toBe(404);
    expect(invalidMetadata.status).toBe(503);
    expect(h.db.log.some((entry) => entry.op === "record_platform_stk_transaction")).toBe(false);
  });

  it("marks declined prompts failed and acks the callback", async () => {
    h.db.seed("platform_stk_payments", [
      { checkout_request_id: "ws_CO_123456", status: "pending" },
    ]);
    const response = await call(Route, "POST", {
      params: { token: TOKEN },
      body: {
        Body: { stkCallback: { CheckoutRequestID: "ws_CO_123456", ResultCode: 1032 } },
      },
    });

    expect(response.status).toBe(200);
    expect(h.db.rows("platform_stk_payments")[0]?.status).toBe("failed");
  });
});
