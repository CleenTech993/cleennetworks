// Smart-TV helpers. Pure functions (no env / DB access) so they are unit-testable.

const MAC_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

/**
 * Normalises a MAC address typed by a person ("aa-bb-cc-dd-ee-ff", "AABB.CCDD.EEFF", ...) to
 * "AA:BB:CC:DD:EE:FF". Returns null if it is not a usable unicast MAC. Because the result is
 * strictly hex + colons it is always safe to place inside a generated RouterOS script.
 */
export function normalizeMac(input: string): string | null {
  const raw = input.trim();
  if (!/^[0-9A-Fa-f:.\-\s]+$/.test(raw)) return null;
  const hex = raw.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (hex.length !== 12) return null;
  const mac = hex.match(/.{2}/g)!.join(":");
  return isUsableMac(mac) ? mac : null;
}

/** Rejects all-zero and multicast/broadcast addresses (lowest bit of the first octet set). */
export function isUsableMac(mac: string): boolean {
  if (!MAC_RE.test(mac)) return false;
  if (mac === "00:00:00:00:00:00") return false;
  return (parseInt(mac.slice(0, 2), 16) & 1) === 0;
}

/**
 * "Private" / randomised Wi-Fi addresses have the locally-administered bit set. Many TVs
 * generate one per network, so the customer must register the address the TV uses on THIS
 * Wi-Fi, not the one printed on its sticker.
 */
export function isRandomizedMac(mac: string): boolean {
  return (parseInt(mac.slice(0, 2), 16) & 2) !== 0;
}

export interface SyncTv {
  mac_address: string;
  status: string;
  expires_at: string | null;
}

export const TV_BINDING_COMMENT = "netgrid-tv";

/** True when the TV should currently be allowed through the hotspot. */
export function isTvActive(tv: SyncTv, now: number = Date.now()): boolean {
  if (tv.status !== "active") return false;
  if (!tv.expires_at || new Date(tv.expires_at).getTime() <= now) return false;
  return isUsableMac(tv.mac_address);
}

/**
 * RouterOS lines that make the router's hotspot bypass bindings match the platform.
 *
 * Active TVs get an `ip-binding type=bypassed`, so they reach the internet without the login
 * page. Bindings are reconciled rather than rebuilt: a TV that is still allowed is never
 * touched (no dropped connection every sync), and a TV that expired or was blocked has its
 * binding removed AND its hotspot host/active entry cleared so the cut-off is immediate.
 */
export function buildTvSyncLines(tvs: SyncTv[], now: number = Date.now()): string[] {
  const macs = [...new Set(tvs.filter((t) => isTvActive(t, now)).map((t) => t.mac_address))];
  return [
    "# Smart TVs: bypass the hotspot login for paid MAC addresses",
    ":do {",
    `  :local ngTv [:toarray "${macs.join(",")}"]`,
    `  :foreach b in=[/ip hotspot ip-binding find where comment="${TV_BINDING_COMMENT}"] do={`,
    "    :local m [/ip hotspot ip-binding get $b mac-address]",
    '    :if ([:typeof [:find $ngTv $m]] = "nil") do={',
    "      :do { /ip hotspot active remove [find where mac-address=$m] } on-error={}",
    "      :do { /ip hotspot host remove [find where mac-address=$m] } on-error={}",
    "      /ip hotspot ip-binding remove $b",
    "    }",
    "  }",
    "  :foreach m in=$ngTv do={",
    `    :if ([:len [/ip hotspot ip-binding find where mac-address=$m comment="${TV_BINDING_COMMENT}"]] = 0) do={`,
    `      /ip hotspot ip-binding add mac-address=$m type=bypassed server=netgrid-hs comment="${TV_BINDING_COMMENT}"`,
    "    }",
    "  }",
    '} on-error={ :log warning "NetGrid: smart-TV sync failed" }',
  ];
}
