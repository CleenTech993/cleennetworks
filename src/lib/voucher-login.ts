// Rules for getting a customer from "voucher accepted" to "actually online". Pure functions (no env /
// DB access) so they are unit-testable.
//
// Background: the portal marks a voucher used, then sends the phone to the router's /login with the
// code. The router only knows a voucher after its next sync (every 2 minutes), and until now a used
// code could never be entered again, so one failed first login stranded the customer for good.

/** Portal timings while it waits for the router to receive a new voucher. */
export const READY_POLL_MS = 5_000;
/** Give up waiting after a little over one sync interval (2 min) and just try the login. */
export const READY_WAIT_MAX_MS = 150_000;
/** After the router has fetched its script, give it a moment to finish running it. */
export const READY_SETTLE_MS = 6_000;

/** Margin so a small clock difference between the database and the app can never say "synced" early. */
export const SYNC_MARGIN_MS = 5_000;

/**
 * True when the router's last sync already included this voucher. `lastSyncAt` is the moment the
 * router last fetched its sync script; the voucher is in that script only if it existed before then.
 */
export function voucherReachedRouter(
  lastSyncAt: string | null | undefined,
  voucherCreatedAt: string | null | undefined,
): boolean {
  if (!voucherCreatedAt) return true; // nothing to wait for
  if (!lastSyncAt) return false;
  const sync = new Date(lastSyncAt).getTime();
  const created = new Date(voucherCreatedAt).getTime();
  if (!Number.isFinite(sync) || !Number.isFinite(created)) return false;
  return sync >= created + SYNC_MARGIN_MS;
}

export type ReloginVerdict = { ok: true } | { ok: false; error: string };

/**
 * May a code that is already "used" be used to log in again? Yes while it has not expired: the same
 * device reconnecting, a retry after a failed first login, or another device on a multi-device plan
 * (the router enforces the device limit and the MAC pin). The only refusal is a one-device plan that
 * is pinned to a different device.
 */
export function canRelogin(
  v: { status: string; expires_at: string | null; bound_mac: string | null },
  deviceLimit: number,
  mac: string | null,
  now: number = Date.now(),
): ReloginVerdict {
  if (v.status !== "used") return { ok: false, error: "Voucher already used" };
  if (v.expires_at && new Date(v.expires_at).getTime() <= now) {
    return { ok: false, error: "Voucher expired" };
  }
  if (deviceLimit === 1 && v.bound_mac && mac && v.bound_mac.toUpperCase() !== mac.toUpperCase()) {
    return { ok: false, error: "This voucher is already in use on another device." };
  }
  return { ok: true };
}

/**
 * The router passes its own login error text back to the portal in the query string, so it is
 * untrusted: keep it short and plain. (React renders it as text, never as markup.)
 */
export function cleanRouterError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Control characters and angle brackets become spaces (checked by code, not a regex, so no control
  // characters appear in the source).
  const plain = Array.from(raw, (ch) => {
    const c = ch.charCodeAt(0);
    return c < 32 || c === 127 || ch === "<" || ch === ">" ? " " : ch;
  }).join("");
  const v = plain.replace(/\s+/g, " ").trim().slice(0, 160);
  return v || null;
}

export interface LoginErrorHelp {
  /** What the customer should do, in plain words. */
  hint: string;
  /** True when simply trying the same code again shortly is the right advice. */
  retry: boolean;
}

/** Plain-language advice for the error strings RouterOS produces. Unknown errors get a generic hint. */
export function explainLoginError(message: string): LoginErrorHelp {
  const m = message.toLowerCase();
  if (/invalid username or password/.test(m)) {
    return {
      hint: "A brand-new voucher can take up to 2 minutes to reach the Wi-Fi router. Wait a moment, then enter the same code again.",
      retry: true,
    };
  }
  if (/no more sessions|already (active|logged)|shared/.test(m)) {
    return {
      hint: "This voucher is already connected on the maximum number of devices. Disconnect one first.",
      retry: false,
    };
  }
  if (/mac/.test(m)) {
    return { hint: "This voucher is tied to a different device.", retry: false };
  }
  if (/(limit|expired|uptime)/.test(m)) {
    return { hint: "This voucher's time or data has run out.", retry: false };
  }
  return { hint: "Enter the same code again, or ask for help if it keeps happening.", retry: true };
}
