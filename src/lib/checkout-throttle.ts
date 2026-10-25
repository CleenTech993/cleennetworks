// Limits for the public portal checkout, which sends an M-Pesa prompt to ANY phone number a
// stranger types in. Pure functions (relative imports only) so they are unit-testable.

export const CHECKOUT_LIMITS = {
  /** At most this many prompts per phone number... */
  phoneMax: 3,
  /** ...within this window (counts every attempt: pending, failed or paid). */
  phoneWindowMs: 10 * 60_000,
  /** A second prompt for the same package while the first is still pending is refused. */
  cooldownMs: 60_000,
  /** Per-IP burst limit (per server instance, see rate-limit.server.ts). */
  ipMax: 6,
  ipWindowMs: 60_000,
} as const;

/** Safaricom-style Kenyan mobile in 2547XXXXXXXX / 2541XXXXXXXX form (after normalizePhone). */
export function isValidKenyanMobile(msisdn: string): boolean {
  return /^254[17]\d{8}$/.test(msisdn);
}

export interface RecentPayment {
  id: string;
  /** ISO timestamp exactly as returned by the database (microsecond precision). */
  created_at: string;
  status: string;
  package_id: string | null;
}

export type ThrottleVerdict =
  { ok: true } | { ok: false; reason: "cooldown" | "phone_limit"; retryAfterSec: number };

const ts = (p: RecentPayment) => Date.parse(p.created_at);
// Total order used to rank concurrent requests: creation time, then id.
const before = (a: RecentPayment, b: RecentPayment) =>
  a.created_at < b.created_at || (a.created_at === b.created_at && a.id < b.id);

/**
 * Decide whether `mine` (a payment row that was JUST inserted) may go on to send a prompt.
 * `others` are the other payments for the same tenant + phone. Only payments ranked BEFORE
 * `mine` count against it, and every request counts after its own insert, so a burst of parallel
 * requests cannot all slip through: the first `phoneMax` win, the rest are refused.
 */
export function throttleVerdict(
  mine: RecentPayment,
  others: RecentPayment[],
  now: number = Date.now(),
  limits: typeof CHECKOUT_LIMITS = CHECKOUT_LIMITS,
): ThrottleVerdict {
  const earlier = others
    .filter((o) => o.id !== mine.id && before(o, mine) && now - ts(o) < limits.phoneWindowMs)
    .sort((a, b) => ts(a) - ts(b));

  const pendingSame = earlier.find(
    (o) =>
      o.status === "pending" && o.package_id === mine.package_id && now - ts(o) < limits.cooldownMs,
  );
  if (pendingSame) {
    return {
      ok: false,
      reason: "cooldown",
      retryAfterSec: Math.max(1, Math.ceil((ts(pendingSame) + limits.cooldownMs - now) / 1000)),
    };
  }

  if (earlier.length >= limits.phoneMax) {
    // The window frees a slot once enough of the oldest attempts age out.
    const blocking = earlier[earlier.length - limits.phoneMax];
    return {
      ok: false,
      reason: "phone_limit",
      retryAfterSec: Math.max(1, Math.ceil((ts(blocking) + limits.phoneWindowMs - now) / 1000)),
    };
  }
  return { ok: true };
}

export function throttleMessage(v: Extract<ThrottleVerdict, { ok: false }>): string {
  return v.reason === "cooldown"
    ? "A payment prompt was just sent to this number. Check your phone, or wait a minute and try again."
    : "Too many payment attempts for this number. Please try again later.";
}
