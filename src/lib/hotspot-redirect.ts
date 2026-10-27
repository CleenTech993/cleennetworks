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

export interface RouterParams {
  login: string | null;
  mac: string | null;
  /** routers.id of the router the customer is connected to (set by the router's login page). */
  router: string | null;
}
type ParamStore = Pick<Storage, "getItem" | "setItem">;
const STORE_KEYS = { login: "ng_login", mac: "ng_mac", router: "ng_router" } as const;

/** Reads the router's parameters from the URL query, saving them; falls back to what was saved. */
export function routerParams(search: string, store: ParamStore | null): RouterParams {
  const q = new URLSearchParams(search);
  const out: RouterParams = { login: q.get("login"), mac: q.get("mac"), router: q.get("router") };
  for (const k of ["login", "mac", "router"] as const) {
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
