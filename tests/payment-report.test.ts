import { describe, expect, it } from "vitest";
import {
  buildPaymentCsv,
  normalizePaymentSearch,
  summarizeDirectMpesa,
  summarizePayments,
  type PaymentReportRow,
} from "../src/lib/payment-report";

const payments: PaymentReportRow[] = [
  {
    id: "p1",
    created_at: "2026-11-01T10:00:00.000Z",
    phone: "254712345678",
    amount: 100,
    mpesa_receipt: "QW123",
    voucher_code: "ABC123",
    status: "success",
  },
  {
    id: "p2",
    created_at: "2026-10-30T10:00:00.000Z",
    phone: "254700000000",
    amount: 50,
    mpesa_receipt: null,
    voucher_code: null,
    status: "failed",
  },
];

describe("normalizePaymentSearch", () => {
  it("retains receipt characters and strips PostgREST filter syntax", () => {
    expect(normalizePaymentSearch(" QW-123, (ABC) ")).toBe("qw123abc");
    expect(normalizePaymentSearch(" +254 712 345 678 ")).toBe("254712345678");
    expect(normalizePaymentSearch(" ,%._() ")).toBe("");
  });
});

describe("buildPaymentCsv", () => {
  it("escapes quotes and neutralizes spreadsheet formulas", () => {
    const csv = buildPaymentCsv([
      {
        ...payments[0]!,
        phone: '=HYPERLINK("https://example.test")',
        mpesa_receipt: 'Q"W123',
      },
    ]);

    expect(csv).toContain(`"'=HYPERLINK(""https://example.test"")"`);
    expect(csv).toContain('"Q""W123"');
    expect(csv).toContain('"100.00"');
  });
});

describe("payment summaries", () => {
  it("counts value only in the matching STK status bucket", () => {
    expect(
      summarizePayments([
        { amount: 100, status: "success" },
        { amount: 50, status: "pending" },
        { amount: 25, status: "failed" },
        { amount: 10, status: "cancelled" },
      ]),
    ).toEqual({
      totalCount: 4,
      successfulCount: 1,
      successfulAmount: 100,
      pendingCount: 1,
      pendingAmount: 50,
      unsuccessfulCount: 2,
      unsuccessfulAmount: 35,
    });
  });

  it("keeps C2B review, approval, and rejection totals distinct", () => {
    expect(
      summarizeDirectMpesa([
        { amount: 100, status: "received" },
        { amount: 50, status: "approved" },
        { amount: 25, status: "rejected" },
      ]),
    ).toEqual({
      capturedAmount: 175,
      capturedCount: 3,
      reviewAmount: 100,
      reviewCount: 1,
      approvedCount: 1,
      rejectedCount: 1,
    });
  });
});
