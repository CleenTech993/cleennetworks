// Abuse guard for the public checkout endpoint. Pure functions (no env / DB access).
//
// Checkout sends an M-Pesa prompt to whatever number the caller types, so without a limit it can be
// used to spam a stranger's phone. The in-memory IP limiter is per server instance and easy to
// sidestep, so the per-phone limit is DURABLE: it is computed from the payment rows themselves.
//
// The caller inserts its own pending payment first, then loads every payment for that phone in the
// window (its own row included) and asks for a verdict. Because every concurrent request sees the
// same ordered list, exactly the earliest ones pass, so a burst of parallel requests cannot all
// slip through before any of them is recorded.

/** How far back attempts are counted. */
export const PHONE_WINDOW_MS = 10 * 60_000;
/** Attempts allowed per phone number inside the window (all tenants, any outcome). */
export const PHONE_MAX_ATTEMPTS = 3;
/** Minimum spacing between two prompts to the same phone. */
export const PHONE_MIN_GAP_MS = 30_000;

export interface PhoneAttempt {
  id: string;
  created_at: string;
}

export type PhoneVerdict =
  { ok: true } | { ok: false; reason: "gap" | "limit"; retryAfterSec: number; message: string };

const byAge = (a: PhoneAttempt, b: PhoneAttempt) =>
  new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id);

/**
 * @param attempts every payment for this phone inside the window, INCLUDING the one being checked
 * @param selfId   id of the payment row this request just inserted
 */
export function evaluatePhoneAttempts(attempts: PhoneAttempt[], selfId: string): PhoneVerdict {
  const ordered = [...attempts].sort(byAge);
  const idx = ordered.findIndex((a) => a.id === selfId);
  // Our own row is missing (should not happen): fail closed.
  if (idx === -1) {
    return {
      ok: false,
      reason: "limit",
      retryAfterSec: 60,
      message: "Please try again in a minute.",
    };
  }

  if (idx >= PHONE_MAX_ATTEMPTS) {
    const oldest = ordered[idx - PHONE_MAX_ATTEMPTS];
    const freeAt = new Date(oldest.created_at).getTime() + PHONE_WINDOW_MS;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((freeAt - new Date(ordered[idx].created_at).getTime()) / 1000),
    );
    return {
      ok: false,
      reason: "limit",
      retryAfterSec,
      message:
        "Too many payment attempts for this number. Please wait a few minutes and try again.",
    };
  }

  const prev = ordered[idx - 1];
  if (prev) {
    const gap = new Date(ordered[idx].created_at).getTime() - new Date(prev.created_at).getTime();
    if (gap < PHONE_MIN_GAP_MS) {
      return {
        ok: false,
        reason: "gap",
        retryAfterSec: Math.max(1, Math.ceil((PHONE_MIN_GAP_MS - gap) / 1000)),
        message:
          "A payment prompt was just sent to this number. Please wait 30 seconds before trying again.",
      };
    }
  }
  return { ok: true };
}
