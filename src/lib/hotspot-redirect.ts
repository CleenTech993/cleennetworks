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
export function buildHotspotLoginRedirect(raw: string | null | undefined, code: string): string | null {
  const u = parseHotspotLoginUrl(raw);
  if (!u) return null;
  const out = new URL(`${u.origin}/login`);
  out.searchParams.set("username", code);
  out.searchParams.set("password", code);
  return out.toString();
}
