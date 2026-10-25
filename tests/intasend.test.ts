import { describe, expect, it } from "vitest";
import {
  checkPaidInvoice,
  intasendChargeAmount,
  intasendKeyMode,
  invoiceVerdict,
  parseInvoice,
  safeEqual,
} from "../src/lib/intasend";

const PAY = "3f9a1c2b-0000-4000-8000-000000000001";

// Shapes copied from IntaSend's docs (status API and collection_event webhook).
const statusResponse = {
  invoice: {
    invoice_id: "ABC123",
    state: "COMPLETE",
    provider: "M-PESA",
    value: 100,
    charges: 3,
    net_amount: 97,
    currency: "KES",
    account: "254712345678",
    api_ref: PAY,
    provider_ref: "QWE123RTY",
    failed_reason: null,
    failed_code: null,
  },
  meta: { customer: { phone_number: "254712345678", email: null } },
};
const webhookBody = {
  invoice_id: "ABC123",
  state: "COMPLETE",
  provider: "M-PESA",
  charges: "3.00",
  net_amount: "97.00",
  currency: "KES",
  value: "100.00",
  account: "254712345678",
  api_ref: PAY,
  provider_ref: "SJT8H2K9QW",
  mpesa_reference: "SJT8H2K9QW",
  failed_reason: null,
  failed_code: null,
  topic: "collection_event",
  challenge: "x",
};

describe("parseInvoice", () => {
  it("reads the status API shape (numeric amounts, nested invoice)", () => {
    expect(parseInvoice(statusResponse)).toEqual({
      invoiceId: "ABC123",
      state: "COMPLETE",
      value: 100,
      currency: "KES",
      apiRef: PAY,
      receipt: "QWE123RTY",
      failedReason: null,
      failedCode: null,
    });
  });
  it("reads the webhook shape (string amounts, flat) and prefers mpesa_reference", () => {
    const inv = parseInvoice(webhookBody);
    expect(inv).toMatchObject({
      invoiceId: "ABC123",
      value: 100,
      receipt: "SJT8H2K9QW",
      apiRef: PAY,
    });
  });
  it("reads a failed invoice", () => {
    const inv = parseInvoice({
      invoice_id: "Z",
      state: "failed",
      failed_reason: "Request cancelled by user",
      failed_code: "1032",
    });
    expect(inv).toMatchObject({
      state: "FAILED",
      failedCode: "1032",
      failedReason: "Request cancelled by user",
      receipt: null,
    });
  });
  it("returns null for anything that is not an invoice", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      5,
      {},
      { invoice: {} },
      { invoice_id: "A" },
      { state: "COMPLETE" },
    ]) {
      expect(parseInvoice(bad)).toBeNull();
    }
  });
});

describe("invoiceVerdict", () => {
  it("only COMPLETE is paid", () => {
    expect(invoiceVerdict("COMPLETE")).toBe("paid");
    expect(invoiceVerdict("complete")).toBe("paid");
  });
  it("FAILED and CANCELED are failures", () => {
    for (const s of ["FAILED", "CANCELED", "CANCELLED"]) expect(invoiceVerdict(s)).toBe("failed");
  });
  it("in-flight and partial states stay pending", () => {
    for (const s of ["PENDING", "PROCESSING", "RETRY", "PARTIAL", "SOMETHING_NEW"])
      expect(invoiceVerdict(s)).toBe("pending");
  });
});

describe("checkPaidInvoice", () => {
  const inv = parseInvoice(statusResponse)!;
  const expected = { paymentId: PAY, invoiceId: "ABC123", amount: 100 };

  it("accepts a matching paid invoice", () => {
    expect(checkPaidInvoice(inv, expected)).toEqual({ ok: true });
  });
  it("rejects a different payment reference", () => {
    expect(checkPaidInvoice({ ...inv, apiRef: "someone-else" }, expected)).toMatchObject({
      ok: false,
      reason: "reference_mismatch",
    });
    expect(checkPaidInvoice({ ...inv, apiRef: null }, expected)).toMatchObject({
      ok: false,
      reason: "reference_mismatch",
    });
  });
  it("rejects a different invoice id", () => {
    expect(checkPaidInvoice({ ...inv, invoiceId: "OTHER" }, expected)).toMatchObject({
      ok: false,
      reason: "invoice_mismatch",
    });
  });
  it("rejects underpayment but accepts a customer-pays surcharge", () => {
    expect(checkPaidInvoice({ ...inv, value: 99 }, expected)).toMatchObject({
      ok: false,
      reason: "underpaid",
    });
    expect(checkPaidInvoice({ ...inv, value: 103 }, expected)).toEqual({ ok: true });
    expect(checkPaidInvoice({ ...inv, value: null }, expected)).toMatchObject({
      ok: false,
      reason: "amount_missing",
    });
  });
  it("rejects a non-KES invoice", () => {
    expect(checkPaidInvoice({ ...inv, currency: "USD" }, expected)).toMatchObject({
      ok: false,
      reason: "currency",
    });
  });
  it("compares against the whole-shilling amount we actually charged", () => {
    expect(checkPaidInvoice({ ...inv, value: 50 }, { ...expected, amount: 49.5 })).toEqual({
      ok: true,
    });
    expect(checkPaidInvoice({ ...inv, value: 49 }, { ...expected, amount: 49.5 })).toMatchObject({
      ok: false,
    });
  });
});

describe("helpers", () => {
  it("rounds the charge up to a whole shilling, minimum 1", () => {
    expect(intasendChargeAmount(49.2)).toBe(50);
    expect(intasendChargeAmount(100)).toBe(100);
    expect(intasendChargeAmount(0)).toBe(1);
  });
  it("compares the webhook challenge exactly", () => {
    expect(safeEqual("my-secret", "my-secret")).toBe(true);
    expect(safeEqual("my-secret", "my-secreT")).toBe(false);
    expect(safeEqual("my-secret", "my-secret-longer")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
  it("tells sandbox from live keys by prefix", () => {
    expect(intasendKeyMode("ISSecretKey_test_abc")).toBe("test");
    expect(intasendKeyMode("ISSecretKey_live_abc")).toBe("live");
    expect(intasendKeyMode("something")).toBeNull();
    expect(intasendKeyMode(undefined)).toBeNull();
  });
});
