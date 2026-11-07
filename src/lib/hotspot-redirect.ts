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

/** Accept only absolute HTTP(S) destinations without embedded credentials. */
export function parseHotspotDestinationUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password)
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Voucher codes are the hotspot username AND password (see the router sync script). */
export function buildHotspotLoginRedirect(
  raw: string | null | undefined,
  code: string,
  destination?: string | null,
): string | null {
  const u = parseHotspotLoginUrl(raw);
  if (!u) return null;
  const out = new URL(`${u.origin}/login`);
  out.searchParams.set("username", code);
  out.searchParams.set("password", code);
  const dst =
    parseHotspotDestinationUrl(destination) ??
    parseHotspotDestinationUrl(u.searchParams.get("dst"));
  if (dst) out.searchParams.set("dst", dst);
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

export const LOGIN_RETRY_DELAY_MS = 2_000;
/** Covers the five-minute full-sync cycle while a router installs the fast voucher poll. */
export const LOGIN_RETRY_WINDOW_MS = 7 * 60_000;
const VOUCHER_KEYS = (scope?: string) =>
  scope
    ? { code: `ng_voucher_${scope}`, at: `ng_voucher_at_${scope}` }
    : { code: "ng_voucher", at: "ng_voucher_at" };
const REMEMBERABLE_CODE = /^[A-Za-z0-9._@-]{1,64}$/;

export function rememberVoucher(
  store: ParamStore | null,
  code: string,
  scope?: string,
  now = Date.now(),
): void {
  if (!REMEMBERABLE_CODE.test(code)) return;
  const keys = VOUCHER_KEYS(scope);
  try {
    store?.setItem(keys.code, code);
    store?.setItem(keys.at, String(now));
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
  scope?: string,
  now = Date.now(),
): RememberedVoucher | null {
  const keys = VOUCHER_KEYS(scope);
  try {
    const code = store?.getItem(keys.code);
    if (!code || !REMEMBERABLE_CODE.test(code)) return null;
    const at = Number(store?.getItem(keys.at));
    return { code, retry: Number.isFinite(at) && now - at < LOGIN_RETRY_WINDOW_MS };
  } catch {
    return null;
  }
}

export interface RouterParams {
  login: string | null;
  mac: string | null;
  destination: string | null;
  routerId: string | null;
}
type ParamStore = Pick<Storage, "getItem" | "setItem">;
const STORE_KEYS = {
  login: "ng_login",
  mac: "ng_mac",
  destination: "ng_dst",
  routerId: "ng_router",
} as const;

/** Reads the router's parameters from the URL query, saving them; falls back to what was saved. */
export function routerParams(
  search: string,
  store: ParamStore | null,
  scope?: string,
): RouterParams {
  const q = new URLSearchParams(search);
  const keys = scope
    ? {
        login: `ng_login_${scope}`,
        mac: `ng_mac_${scope}`,
        destination: `ng_dst_${scope}`,
        routerId: `ng_router_${scope}`,
      }
    : STORE_KEYS;
  const rawRouterId = q.get("router");
  const out: RouterParams = {
    login: q.get("login"),
    mac: q.get("mac"),
    destination: q.get("dst"),
    routerId: rawRouterId && /^[0-9a-f-]{36}$/i.test(rawRouterId) ? rawRouterId : null,
  };
  for (const k of ["login", "mac", "destination", "routerId"] as const) {
    try {
      const present = out[k];
      if (present) store?.setItem(keys[k], present);
      else out[k] = store?.getItem(keys[k]) ?? null;
    } catch {
      // Storage can be blocked in captive-portal browsers; the URL values still work.
    }
  }
  if (out.routerId && !/^[0-9a-f-]{36}$/i.test(out.routerId)) out.routerId = null;
  return out;
}
