import { describe, expect, it } from "vitest";
import { isKenyanMobile, normalizePhone } from "../src/lib/phone";
import {
  PHONE_MAX_ATTEMPTS,
  PHONE_MIN_GAP_MS,
  PHONE_WINDOW_MS,
  evaluatePhoneAttempts,
  type PhoneAttempt,
} from "../src/lib/checkout-guard";

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const at = (id: string, msAfter: number): PhoneAttempt => ({ id, created_at: new Date(T0 + msAfter).toISOString() });

describe("normalizePhone / isKenyanMobile", () => {
  it("normalises the common ways Kenyans write a number", () => {
    for (const raw of ["0712345678", "712345678", "+254712345678", "254712345678", "0712 345 678", "07-12-345-678"]) {
      expect(normalizePhone(raw)).toBe("254712345678");
    }
    expect(normalizePhone("0112345678")).toBe("254112345678");
  });

  it("accepts only 254 7XX / 254 1XX mobile numbers", () => {
    expect(isKenyanMobile("254712345678")).toBe(true);
    expect(isKenyanMobile("254112345678")).toBe(true);
    expect(isKenyanMobile("25471234567")).toBe(false); // too short
    expect(isKenyanMobile("2547123456789")).toBe(false); // too long
    expect(isKenyanMobile("254212345678")).toBe(false); // landline range
    expect(isKenyanMobile("447911123456")).toBe(false); // foreign
    expect(isKenyanMobile(normalizePhone("not a number"))).toBe(false);
  });
});

describe("evaluatePhoneAttempts", () => {
  it("lets a first attempt through", () => {
    expect(evaluatePhoneAttempts([at("a", 0)], "a")).toEqual({ ok: true });
  });

  it("blocks a second prompt that follows too quickly, and tells the caller how long to wait", () => {
    const v = evaluatePhoneAttempts([at("a", 0), at("b", 5_000)], "b");
    expect(v).toMatchObject({ ok: false, reason: "gap" });
    if (!v.ok) expect(v.retryAfterSec).toBe(Math.ceil((PHONE_MIN_GAP_MS - 5_000) / 1000));
  });

  it("allows another prompt once the minimum gap has passed", () => {
    expect(evaluatePhoneAttempts([at("a", 0), at("b", PHONE_MIN_GAP_MS)], "b")).toEqual({ ok: true });
  });

  it("allows exactly PHONE_MAX_ATTEMPTS in the window and blocks the next one", () => {
    const rows = Array.from({ length: PHONE_MAX_ATTEMPTS + 1 }, (_, i) => at(`r${i}`, i * 60_000));
    for (let i = 0; i < PHONE_MAX_ATTEMPTS; i++) expect(evaluatePhoneAttempts(rows, `r${i}`)).toEqual({ ok: true });
    const v = evaluatePhoneAttempts(rows, `r${PHONE_MAX_ATTEMPTS}`);
    expect(v).toMatchObject({ ok: false, reason: "limit" });
    // retry-after = until the oldest counted attempt leaves the window
    if (!v.ok) expect(v.retryAfterSec).toBe(Math.ceil((PHONE_WINDOW_MS - PHONE_MAX_ATTEMPTS * 60_000) / 1000));
  });

  it("is order-independent: concurrent requests all see the same winners", () => {
    const rows = [at("c", 0), at("a", 0), at("b", 0)]; // identical timestamps -> tie broken by id
    const verdicts = ["a", "b", "c"].map((id) => evaluatePhoneAttempts([...rows].reverse(), id).ok);
    expect(verdicts).toEqual([true, false, false]); // only the earliest (a) passes
  });

  it("fails closed when the caller's own row is missing", () => {
    expect(evaluatePhoneAttempts([at("a", 0)], "zzz")).toMatchObject({ ok: false });
  });
});
