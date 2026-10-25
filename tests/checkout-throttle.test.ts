import { describe, expect, it } from "vitest";
import {
  CHECKOUT_LIMITS,
  isValidKenyanMobile,
  throttleMessage,
  throttleVerdict,
  type RecentPayment,
} from "../src/lib/checkout-throttle";
import { isAal2 } from "../src/lib/aal";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const at = (secAgo: number) => new Date(NOW - secAgo * 1000).toISOString();
const pay = (
  id: string,
  secAgo: number,
  status = "failed",
  pkg: string | null = "p1",
): RecentPayment => ({
  id,
  created_at: at(secAgo),
  status,
  package_id: pkg,
});

describe("isValidKenyanMobile", () => {
  it("accepts normalized Safaricom-style numbers", () => {
    expect(isValidKenyanMobile("254712345678")).toBe(true);
    expect(isValidKenyanMobile("254112345678")).toBe(true);
  });
  it("rejects junk, short and foreign numbers", () => {
    for (const bad of [
      "",
      "0712345678",
      "25471234567",
      "2547123456789",
      "254212345678",
      "447911123456",
      "abc",
    ]) {
      expect(isValidKenyanMobile(bad)).toBe(false);
    }
  });
});

describe("throttleVerdict", () => {
  const mine = pay("m", 0, "pending");

  it("allows the first attempts for a phone", () => {
    expect(throttleVerdict(mine, [], NOW).ok).toBe(true);
    expect(throttleVerdict(mine, [pay("a", 300), pay("b", 200)], NOW).ok).toBe(true);
  });

  it("refuses once the phone has reached the limit within the window", () => {
    const others = [pay("a", 500), pay("b", 400), pay("c", 300)];
    const v = throttleVerdict(mine, others, NOW);
    expect(v).toMatchObject({ ok: false, reason: "phone_limit" });
    // the oldest attempt (500s ago) ages out of the 600s window in 100s
    if (!v.ok) expect(v.retryAfterSec).toBe(100);
  });

  it("ignores attempts older than the window", () => {
    const others = [pay("a", 5000), pay("b", 4000), pay("c", 3000), pay("d", 2000)];
    expect(throttleVerdict(mine, others, NOW).ok).toBe(true);
  });

  it("refuses a second prompt for the same package while one is still pending", () => {
    const v = throttleVerdict(mine, [pay("a", 20, "pending", "p1")], NOW);
    expect(v).toMatchObject({ ok: false, reason: "cooldown", retryAfterSec: 40 });
  });

  it("does not apply the cooldown to a different package or a finished payment", () => {
    expect(throttleVerdict(mine, [pay("a", 20, "pending", "other")], NOW).ok).toBe(true);
    expect(throttleVerdict(mine, [pay("a", 20, "failed", "p1")], NOW).ok).toBe(true);
    expect(throttleVerdict(mine, [pay("a", 90, "pending", "p1")], NOW).ok).toBe(true);
  });

  it("only counts payments ranked BEFORE this one, so parallel requests cannot all pass", () => {
    // Four requests inserted back to back; each one sees all four rows after inserting.
    const rows = [pay("r1", 3), pay("r2", 2), pay("r3", 1), pay("r4", 0)].map((r) => ({
      ...r,
      status: "pending",
      package_id: null,
    }));
    const verdicts = rows.map((r) =>
      throttleVerdict(r, rows, NOW, { ...CHECKOUT_LIMITS, cooldownMs: 0 }),
    );
    expect(verdicts.map((v) => v.ok)).toEqual([true, true, true, false]);
  });

  it("breaks timestamp ties by id so both requests agree who goes first", () => {
    const a = { id: "a", created_at: at(0), status: "pending", package_id: null };
    const b = { id: "b", created_at: at(0), status: "pending", package_id: null };
    const noCooldown = { ...CHECKOUT_LIMITS, phoneMax: 1, cooldownMs: 0 };
    expect(throttleVerdict(a, [a, b], NOW, noCooldown).ok).toBe(true);
    expect(throttleVerdict(b, [a, b], NOW, noCooldown).ok).toBe(false);
  });

  it("has a human message for each refusal", () => {
    expect(throttleMessage({ ok: false, reason: "cooldown", retryAfterSec: 5 })).toMatch(
      /check your phone/i,
    );
    expect(throttleMessage({ ok: false, reason: "phone_limit", retryAfterSec: 5 })).toMatch(
      /too many/i,
    );
  });
});

describe("isAal2", () => {
  it("is true only for an aal2 token", () => {
    expect(isAal2({ aal: "aal2" })).toBe(true);
    expect(isAal2({ aal: "aal1" })).toBe(false);
    expect(isAal2({})).toBe(false);
    expect(isAal2(null)).toBe(false);
    expect(isAal2(undefined)).toBe(false);
    expect(isAal2({ aal: "AAL2" })).toBe(false);
  });
});
