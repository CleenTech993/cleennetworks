import { describe, expect, it } from "vitest";
import {
  calculateOpenBalance,
  invoiceAgingBucket,
  invoiceStatusForBalance,
} from "../src/lib/customer-billing";

describe("customer billing lifecycle helpers", () => {
  it("marks a partially paid invoice as partial until the balance is fully settled", () => {
    expect(
      invoiceStatusForBalance({
        amount: 2500,
        paidAmount: 1500,
        dueAt: "2026-11-20T00:00:00.000Z",
        now: "2026-11-10T00:00:00.000Z",
      }),
    ).toBe("partial");

    expect(
      invoiceStatusForBalance({
        amount: 2500,
        paidAmount: 2500,
        dueAt: "2026-11-20T00:00:00.000Z",
        now: "2026-11-10T00:00:00.000Z",
      }),
    ).toBe("paid");
  });

  it("flags overdue invoices once the due date has passed", () => {
    expect(
      invoiceStatusForBalance({
        amount: 2500,
        paidAmount: 0,
        dueAt: "2026-11-01T00:00:00.000Z",
        now: "2026-11-10T00:00:00.000Z",
      }),
    ).toBe("overdue");
  });

  it("groups balances into aging buckets for collections reporting", () => {
    expect(
      invoiceAgingBucket({
        dueAt: "2026-10-01T00:00:00.000Z",
        now: "2026-11-10T00:00:00.000Z",
      }),
    ).toBe("30-plus");

    expect(
      invoiceAgingBucket({
        dueAt: "2026-11-01T00:00:00.000Z",
        now: "2026-11-10T00:00:00.000Z",
      }),
    ).toBe("7-30");
  });

  it("keeps the open invoice balance aligned with payments and credits", () => {
    expect(
      calculateOpenBalance({
        amount: 4500,
        paidAmount: 1500,
        adjustmentAmount: 500,
      }),
    ).toBe(3500);
  });
});
