// After a customer redeems a voucher in the portal, the browser must be sent to the
// router's hotspot login URL so the device actually gets internet. The router passes that
// URL to the portal as ?login=<link-login-only>. It arrives via a query string, so it is
// untrusted: only a plain-http /login URL on the router's private address (or the hotspot
// DNS name) is accepted, otherwise a crafted portal link could send the voucher code elsewhere.
// Pure functions (no imports) so they are unit-testable.

const PRIVATE_V4 =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
const HOTSPOT_DNS_NAME = "hotspot.netgrid";

export function parseHotspotLoginUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (!(PRIVATE_V4.test(u.hostname) || u.hostname === HOTSPOT_DNS_NAME)) return null;
  if (u.pathname !== "/login") return null;
  return u;
}

/** Voucher codes are the hotspot username AND password (see the router sync script). */
export function buildHotspotLoginRedirect(
  raw: string | null | undefined,
  code: string,
): string | null {
  const u = parseHotspotLoginUrl(raw);
  if (!u) return null;
  const out = new URL(`${u.origin}/login`);
  out.searchParams.set("username", code);
  out.searchParams.set("password", code);
  return out.toString();
}

// ---------------------------------------------------------------------------------------------
// The router's login page sends the customer to the portal with ?mac=…&ip=…&login=…. Anything that
// rewrites or reloads the page later (a payment flow, a captive-portal mini browser) would lose
// them, so they are remembered for the tab as soon as the page loads.
// ---------------------------------------------------------------------------------------------

/** True when the router's login page sent the customer back because it refused a login (?failed=1). */
export function routerLoginFailed(search: string): boolean {
  return new URLSearchParams(search).get("failed") === "1";
}

// ---------------------------------------------------------------------------------------------
// Redeeming a voucher only marks it used in the database; the router learns about new vouchers on
// its next sync (every couple of minutes). A login attempted straight after redeeming can therefore
// be refused. The code is remembered for the tab so the portal can retry the router login by itself
// until the router has the voucher, instead of leaving the customer stuck.
// ---------------------------------------------------------------------------------------------

export const LOGIN_RETRY_DELAY_MS = 10_000;
/** A little longer than two sync intervals. */
export const LOGIN_RETRY_WINDOW_MS = 4 * 60_000;
const VOUCHER_KEYS = { code: "ng_voucher", at: "ng_voucher_at" } as const;
const REMEMBERABLE_CODE = /^[A-Za-z0-9._@-]{1,64}$/;

export function rememberVoucher(store: ParamStore | null, code: string, now = Date.now()): void {
  if (!REMEMBERABLE_CODE.test(code)) return;
  try {
    store?.setItem(VOUCHER_KEYS.code, code);
    store?.setItem(VOUCHER_KEYS.at, String(now));
  } catch {
    // Blocked storage only costs the automatic retry; entering the code again still works.
  }
}

export interface RememberedVoucher {
  code: string;
  /** Retrying is still worthwhile (the router should learn the voucher within the window). */
  retry: boolean;
}

export function recallVoucher(
  store: ParamStore | null,
  now = Date.now(),
): RememberedVoucher | null {
  try {
    const code = store?.getItem(VOUCHER_KEYS.code);
    if (!code || !REMEMBERABLE_CODE.test(code)) return null;
    const at = Number(store?.getItem(VOUCHER_KEYS.at));
    return { code, retry: Number.isFinite(at) && now - at < LOGIN_RETRY_WINDOW_MS };
  } catch {
    return null;
  }
}

export interface RouterParams {
  login: string | null;
  mac: string | null;
}
type ParamStore = Pick<Storage, "getItem" | "setItem">;
const STORE_KEYS = { login: "ng_login", mac: "ng_mac" } as const;

/** Reads the router's parameters from the URL query, saving them; falls back to what was saved. */
export function routerParams(search: string, store: ParamStore | null): RouterParams {
  const q = new URLSearchParams(search);
  const out: RouterParams = { login: q.get("login"), mac: q.get("mac") };
  for (const k of ["login", "mac"] as const) {
    try {
      const present = out[k];
      if (present) store?.setItem(STORE_KEYS[k], present);
      else out[k] = store?.getItem(STORE_KEYS[k]) ?? null;
    } catch {
      // Storage can be blocked in captive-portal browsers; the URL values still work.
    }
  }
  return out;
}
