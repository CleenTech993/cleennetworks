// PPPoE session reporting. Pure functions (no env / DB access) so they are unit-testable.
//
// Every 2 minutes the router sends the platform its active PPPoE sessions. RouterOS exposes the
// client's MAC address as the session's "caller-id", so this is how the console learns each
// client's MAC and whether they are connected right now. Routers pick the script up through the
// normal sync (same mechanism as the hotspot device report), so no re-provisioning is needed.
import { isUsableMac, normalizeMac } from "./tv";

export const MAX_PPPOE_SESSIONS_PER_REPORT = 500;
/** The router reports every 2 minutes; a client counts as connected for a little over two reports. */
export const CONNECTED_WINDOW_MS = 5 * 60 * 1000;

/** Same character set the sync script allows for PPPoE usernames. */
const SAFE_NAME = /^[A-Za-z0-9._@-]{1,64}$/;

export interface PppoeSession {
  username: string;
  mac: string;
  ip: string | null;
}

function cleanIp(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(v)) return null;
  return v.split(".").every((o) => Number(o) <= 255) ? v : null;
}

/**
 * Parses the body pushed by the router: records separated by ";" (or newlines), fields by "|":
 *   username|mac|ip
 * The body comes from a device on the customer's network, so every field is validated and anything
 * malformed is dropped (a crafted name cannot forge extra records because "|" and ";" are separators
 * and are not in the allowed character set).
 */
export function parsePppoeReport(body: string): PppoeSession[] {
  const out: PppoeSession[] = [];
  const seen = new Set<string>();
  for (const rec of body.split(/;|\r?\n/)) {
    if (out.length >= MAX_PPPOE_SESSIONS_PER_REPORT) break;
    const parts = rec.trim().split("|");
    if (parts.length !== 3) continue;
    const username = (parts[0] ?? "").trim();
    const mac = normalizeMac(parts[1] ?? "");
    if (!SAFE_NAME.test(username) || !mac || !isUsableMac(mac) || seen.has(username)) continue;
    seen.add(username);
    out.push({ username, mac, ip: cleanIp(parts[2]) });
  }
  return out;
}

/** True when the router has reported this client's session recently. */
export function isClientConnected(
  lastSeenAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastSeenAt) return false;
  const t = new Date(lastSeenAt).getTime();
  return Number.isFinite(t) && now - t < CONNECTED_WINDOW_MS;
}

// ---------------------------------------------------------------------------------------------
// Platform -> router: the report script
// ---------------------------------------------------------------------------------------------

// RouterOS code (written with plain "$"; escaped when emitted, see below). Sessions are sent in
// batches because a RouterOS string variable cannot grow without limit.
const PPPOE_SCRIPT = `
:local d ""
:local n 0
:foreach a in=[/ppp active find where service=pppoe] do={
  :if ($n < ${MAX_PPPOE_SESSIONS_PER_REPORT}) do={
    :do {
      :local u [/ppp active get $a name]
      :local m [:tostr [/ppp active get $a caller-id]]
      :local ip [:tostr [/ppp active get $a address]]
      :set d ($d . $u . "|" . $m . "|" . $ip . ";")
      :set n ($n + 1)
      :if ([:len $d] > 3000) do={
        :do { /tool fetch url="__URL__" http-method=post http-data=$d mode=https keep-result=no } on-error={ :log warning "NetGrid: PPPoE report failed" }
        :set d ""
      }
    } on-error={}
  }
}
:if ([:len $d] > 0) do={
  :do { /tool fetch url="__URL__" http-method=post http-data=$d mode=https keep-result=no } on-error={ :log warning "NetGrid: PPPoE report failed" }
}
`;

const PUSH_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/api\/public\/router\/pppoe\/[A-Za-z0-9_-]+$/;

/**
 * Installs the report script and its 2-minute scheduler on the router. The scheduler is only
 * created when missing: re-creating it on every sync would keep resetting its timer.
 */
export function buildPppoeAgentLines(pushUrl: string): string[] {
  if (!PUSH_URL.test(pushUrl)) return [];
  // Inside a braced script source RouterOS needs "$" written as "\$". Comment lines are for readers
  // of this file only: keep them out of the script the router imports.
  const code = PPPOE_SCRIPT.split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  const source = code.replaceAll("__URL__", pushUrl);
  return [
    "/system script",
    ":do { remove [find where name=netgrid-pppoe] } on-error={}",
    `add name=netgrid-pppoe source={${source}}`,
    ':if ([:len [/system scheduler find where name=netgrid-pppoe]] = 0) do={ /system scheduler add name=netgrid-pppoe interval=2m on-event="/system script run netgrid-pppoe" }',
  ];
}
