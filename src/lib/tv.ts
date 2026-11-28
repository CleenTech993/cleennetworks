// Smart-TV helpers. Pure functions (no env / DB access) so they are unit-testable.

import { routerOsRateLimit } from "./routeros-rate-limit";

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
  download_kbps?: number | null;
  upload_kbps?: number | null;
}

export const TV_BINDING_COMMENT = "netgrid-tv";

/** True when the TV should currently be allowed through the hotspot. */
export function isTvActive(tv: SyncTv, now: number = Date.now()): boolean {
  if (tv.status !== "active") return false;
  if (!tv.expires_at || new Date(tv.expires_at).getTime() <= now) return false;
  return isUsableMac(tv.mac_address);
}

/**
 * RouterOS lines that authenticate TVs by MAC so package rate limits apply without showing a
 * captive portal. Expired and blocked devices are disconnected and their managed users removed.
 */
export function buildTvSyncLines(tvs: SyncTv[], now: number = Date.now()): string[] {
  const active = tvs.filter((tv) => isTvActive(tv, now));
  const byMac = new Map(active.map((tv) => [tv.mac_address, tv]));
  const profileFor = (tv: SyncTv) => {
    const download =
      tv.download_kbps != null && Number.isFinite(tv.download_kbps) && tv.download_kbps > 0
        ? Math.round(tv.download_kbps)
        : 0;
    const upload =
      tv.upload_kbps != null && Number.isFinite(tv.upload_kbps) && tv.upload_kbps > 0
        ? Math.round(tv.upload_kbps)
        : 0;
    const rateLimit = routerOsRateLimit(download, upload);
    return {
      name: rateLimit ? `netgrid-tv-s${upload}-${download}` : "netgrid-tv",
      rateLimit,
    };
  };
  const profiles = new Map<string, { rateLimit: string | null }>();
  for (const tv of active) {
    const profile = profileFor(tv);
    profiles.set(profile.name, { rateLimit: profile.rateLimit });
  }
  const macList = [...byMac.keys()].join(",");
  const lines = [
    "# Smart TVs: MAC login applies the purchased package speed without a captive portal",
    ":do {",
    `  :local ngTv [:toarray "${macList}"]`,
    "  /ip hotspot user profile",
  ];
  for (const [name, profile] of profiles) {
    const rateLimit = profile.rateLimit ? ` rate-limit="${profile.rateLimit}"` : "";
    lines.push(
      `  :do { :if ([:len [find where name=${name}]] = 0) do={ add name=${name} shared-users=1${rateLimit} idle-timeout=none keepalive-timeout=none session-timeout=0s } else={ set [find where name=${name}] shared-users=1${rateLimit} idle-timeout=none keepalive-timeout=none session-timeout=0s } } on-error={ :log warning "NetGrid: TV speed profile ${name} could not be applied" }`,
    );
  }
  if (active.length) {
    lines.push(
      "  /ip hotspot profile",
      '  :do { set [find where name=netgrid-hsprof] login-by=http-chap,http-pap,mac-cookie,mac mac-auth-mode=mac-as-username mac-auth-password="" } on-error={ :log warning "NetGrid: TV MAC authentication could not be enabled" }',
    );
  }
  lines.push(
    "  /ip hotspot ip-binding",
    `  :foreach b in=[find where comment="${TV_BINDING_COMMENT}"] do={ :local m [get $b mac-address]; :do { /ip hotspot active remove [find where mac-address=$m] } on-error={}; :do { /ip hotspot host remove [find where mac-address=$m] } on-error={}; remove $b }`,
    "  /ip hotspot user",
    `  :foreach u in=[find where comment="${TV_BINDING_COMMENT}"] do={ :local m [get $u name]; :if ([:typeof [:find $ngTv $m]] = "nil") do={ :do { /ip hotspot active remove [find where user=$m] } on-error={}; :do { /ip hotspot cookie remove [find where user=$m] } on-error={}; :do { /ip hotspot host remove [find where mac-address=$m] } on-error={}; remove $u } }`,
  );
  for (const [mac, tv] of byMac) {
    const profile = profileFor(tv);
    const user = `[find where name="${mac}" comment="${TV_BINDING_COMMENT}"]`;
    lines.push(
      `  :if ([:len ${user}] > 0) do={ :if ([get ${user} profile] != ${profile.name}) do={ :do { /ip hotspot active remove [find where user="${mac}"] } on-error={} }; :do { set ${user} password="" server=netgrid-hs profile=${profile.name} mac-address=${mac} } on-error={ :log warning "NetGrid: TV MAC user could not be updated" } } else={ :if ([:len [find where name="${mac}"]] = 0) do={ :do { add name="${mac}" password="" server=netgrid-hs profile=${profile.name} mac-address=${mac} comment="${TV_BINDING_COMMENT}" } on-error={ :log warning "NetGrid: TV MAC user could not be added" } } else={ :log warning "NetGrid: TV MAC user conflicts with an existing hotspot user" } }`,
    );
  }
  lines.push('} on-error={ :log warning "NetGrid: smart-TV sync failed" }');
  return lines;
}
