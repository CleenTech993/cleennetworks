// Customer device management helpers. Pure functions (no env / DB access) so they are unit-testable.
//
// How the pieces fit together:
//   * One package = one device. Each hotspot voucher is a router "hotspot user" in a profile with
//     shared-users=<device_limit>, so a code can never be online on more devices than allowed at
//     once. When the limit is 1 the user is also pinned to a single MAC (vouchers.bound_mac), so
//     the code cannot be moved to another device later either.
//   * No tethering / phone-to-phone hotspot. A phone that shares its connection forwards the
//     packets of the devices behind it, and forwarding lowers the IP TTL by 1. The router sets
//     TTL=1 on everything it sends to customers: the phone itself still accepts such packets, but
//     it cannot forward them, so devices behind it get nothing. Separately, traffic arriving with
//     TTL 63/127 (a 64/128 device one hop further away) puts the sender on an address list that
//     the device report uses to flag "tethering suspected".
//   * Every minute the router reports the devices on the hotspot to the platform.

import { isUsableMac, normalizeMac } from "./tv";

export { normalizeMac, isUsableMac };

/** Voucher codes are also the router-side username/password, so they must be script-safe. */
export const SAFE_CODE = /^[A-Za-z0-9._@-]{1,64}$/;

export const TETHER_LIST = "netgrid-tether";
export const BLOCK_COMMENT = "netgrid-block";
export const MAX_DEVICES_PER_REPORT = 300;
export const MAX_DEVICE_LIMIT = 10;

/** packages.device_limit (default 1). Missing/invalid values fall back to 1; capped at 10. */
export function deviceLimitOf(pkg: { device_limit: number | null } | null | undefined): number {
  const n = Math.trunc(Number(pkg?.device_limit ?? 1));
  return Number.isFinite(n) ? Math.min(MAX_DEVICE_LIMIT, Math.max(1, n)) : 1;
}

export const userProfileName = (limit: number) => `netgrid-d${limit}`;

/**
 * May an already-redeemed voucher be presented to the portal again? A one-device plan only by the
 * device that redeemed it (matched by MAC); a multi-device plan by any device, because the router
 * enforces the device limit (shared-users). Never lets a different device take over a one-device code.
 */
export function canResumeVoucher(
  limit: number,
  mac: string | null,
  usedByMac: string | null | undefined,
): boolean {
  if (limit > 1) return true;
  return !!mac && !!usedByMac && mac === usedByMac;
}

// ---------------------------------------------------------------------------------------------
// Router -> platform: device report
// ---------------------------------------------------------------------------------------------

export interface DeviceRecord {
  mac: string;
  ip: string | null;
  hostname: string | null;
  /** Hotspot username (voucher code) of the active session on this device, if any. */
  user: string | null;
  authorized: boolean;
  tether: boolean;
}

function cleanIp(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(v)) return null;
  return v.split(".").every((o) => Number(o) <= 255) ? v : null;
}

function cleanHostname(raw: string | undefined): string | null {
  const v = (raw ?? "")
    .replace(/[^\w .-]/g, "")
    .trim()
    .slice(0, 64);
  return v || null;
}

/**
 * Parses the body pushed by the router: records separated by ";" (or newlines), fields by "|":
 *   mac|ip|hostname|user|authorized|tether
 * Everything comes from a device on the customer's LAN (hostnames are chosen by the customer),
 * so every field is validated and anything malformed is dropped.
 */
export function parseDeviceReport(body: string): DeviceRecord[] {
  const out: DeviceRecord[] = [];
  const seen = new Set<string>();
  for (const rec of body.split(/;|\r?\n/)) {
    if (out.length >= MAX_DEVICES_PER_REPORT) break;
    const parts = rec.trim().split("|");
    if (parts.length !== 6) continue;
    const mac = normalizeMac(parts[0] ?? "");
    if (!mac || seen.has(mac)) continue;
    seen.add(mac);
    const user = (parts[3] ?? "").trim();
    out.push({
      mac,
      ip: cleanIp(parts[1]),
      hostname: cleanHostname(parts[2]),
      user: SAFE_CODE.test(user) ? user : null,
      authorized: (parts[4] ?? "").trim() === "true",
      tether: (parts[5] ?? "").trim() === "1",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Platform -> router: sync script pieces
// ---------------------------------------------------------------------------------------------

export interface SyncVoucher {
  code: string;
  bound_mac: string | null;
  /** From the voucher's package (packages.device_limit). */
  limit: number;
}

function buildHotspotMacAuthLines(vouchers: SyncVoucher[]): string[] {
  const macs = [
    ...new Set(
      vouchers
        .filter((voucher) => SAFE_CODE.test(voucher.code) && voucher.limit === 1)
        .map((voucher) => voucher.bound_mac)
        .filter((mac): mac is string => !!mac && isUsableMac(mac)),
    ),
  ];
  const macList = macs.length ? macs.join(",") : "#";
  const lines = [
    "/ip hotspot user",
    `:local ngCurrentMacUsers [:toarray "${macList}"]`,
    ':foreach ngUser in=[find where comment="netgrid-mac-voucher"] do={ :local ngMac [get $ngUser name]; :if ([:typeof [:find $ngCurrentMacUsers $ngMac]] = "nil") do={ :do { /ip hotspot active remove [find where user=$ngMac] } on-error={}; remove $ngUser } }',
  ];
  if (!macs.length) return lines;

  lines.unshift(
    ':do { /ip hotspot profile set [find name=netgrid-hsprof] login-by=http-chap,http-pap,mac-cookie,mac mac-auth-mode=mac-as-username mac-auth-password="" } on-error={ :log warning "NetGrid: MAC reconnect authentication could not be enabled" }',
  );
  for (const mac of macs) {
    lines.push(
      `:if ([:len [find where name="${mac}" comment="netgrid-mac-voucher"]] > 0) do={ :do { set [find where name="${mac}" comment="netgrid-mac-voucher"] password="" server=netgrid-hs profile=netgrid-d1 mac-address=${mac} } on-error={ :log warning "NetGrid: MAC reconnect user could not be updated" } } else={ :if ([:len [find where name="${mac}"]] = 0) do={ :do { add name="${mac}" password="" server=netgrid-hs profile=netgrid-d1 mac-address=${mac} comment="netgrid-mac-voucher" } on-error={ :log warning "NetGrid: MAC reconnect user could not be added" } } else={ :log warning "NetGrid: MAC reconnect user conflicts with an existing hotspot user" } }`,
    );
  }
  return lines;
}

function buildExpiredVoucherCleanupLines(vouchers: SyncVoucher[]): string[] {
  const validCodes = vouchers.filter((v) => SAFE_CODE.test(v.code)).map((v) => v.code);
  const codeList = validCodes.length ? validCodes.join(",") : "#";
  return [
    `:local ngCurrentVouchers [:toarray "${codeList}"]`,
    "/ip hotspot active",
    ':foreach ngActive in=[find] do={ :local ngCode [get $ngActive user]; :if ([:len [/ip hotspot user find where name=$ngCode comment="netgrid-voucher"]] > 0) do={ :if ([:typeof [:find $ngCurrentVouchers $ngCode]] = "nil") do={ remove $ngActive } } }',
    "/ip hotspot user",
    ':foreach ngUser in=[find where comment="netgrid-voucher"] do={ :local ngCode [get $ngUser name]; :if ([:typeof [:find $ngCurrentVouchers $ngCode]] = "nil") do={ remove $ngUser } }',
  ];
}

/** Keeps live voucher users in place; only missing users are added during sync. */
export function buildHotspotUserLines(vouchers: SyncVoucher[]): string[] {
  const valid = vouchers.filter((v) => SAFE_CODE.test(v.code));
  const limits = [...new Set([1, ...valid.map((v) => v.limit)])].sort((a, b) => a - b);

  const lines = [...buildExpiredVoucherCleanupLines(valid), "/ip hotspot user profile"];
  for (const n of limits) {
    const p = userProfileName(n);
    lines.push(
      `:do { :if ([:len [find name=${p}]] = 0) do={ add name=${p} shared-users=${n} idle-timeout=none keepalive-timeout=none session-timeout=0s } else={ set [find name=${p}] shared-users=${n} idle-timeout=none keepalive-timeout=none session-timeout=0s } } on-error={}`,
    );
  }
  lines.push("/ip hotspot user");
  for (const v of valid) {
    // Only a one-device plan can be pinned to a single MAC.
    const mac =
      v.limit === 1 && v.bound_mac && isUsableMac(v.bound_mac) ? ` mac-address=${v.bound_mac}` : "";
    lines.push(
      `:do { add name="${v.code}" password="${v.code}" server=netgrid-hs profile=${userProfileName(v.limit)}${mac} comment="netgrid-voucher" } on-error={ :do { add name="${v.code}" password="${v.code}" profile=${userProfileName(v.limit)}${mac} comment="netgrid-voucher" } on-error={ :do { add name="${v.code}" password="${v.code}" profile=default comment="netgrid-voucher" } on-error={ :do { add name="${v.code}" password="${v.code}" comment="netgrid-voucher" } on-error={} } } }`,
    );
  }
  for (const v of valid) {
    const mac =
      v.limit === 1 && v.bound_mac && isUsableMac(v.bound_mac) ? ` mac-address=${v.bound_mac}` : "";
    lines.push(`:if ([:len [find where name="${v.code}"]] = 0) do={`);
    lines.push(
      `:do { set [find where name="${v.code}"] server=netgrid-hs profile=${userProfileName(v.limit)}${mac} comment="netgrid-voucher" } on-error={}`,
    );
    lines.push("}");
  }
  lines.push(...buildHotspotMacAuthLines(valid));
  if (valid.length > 0) {
    // Every add above swallows its error, so a router where they all fail (for example no hotspot
    // server called netgrid-hs) would silently refuse every voucher. Compare what we meant to add
    // with what is really there and say so in the router log: /log print where message~"NetGrid"
    lines.push(
      `:do { :local ngWant ${valid.length}; :local ngHave [:len [/ip hotspot user find comment="netgrid-voucher"]]; :if ($ngHave < $ngWant) do={ :log warning ("NetGrid: only " . $ngHave . " of " . $ngWant . " voucher users were added. Check that hotspot server netgrid-hs and the netgrid-d* user profiles exist.") } } on-error={}`,
    );
  }
  return lines;
}

/** Adds missing voucher users without rebuilding the full list on the fast refresh schedule. */
export function buildHotspotVoucherRefreshLines(vouchers: SyncVoucher[]): string[] {
  const valid = vouchers.filter((v) => SAFE_CODE.test(v.code));
  const limits = [...new Set(valid.map((v) => v.limit))].sort((a, b) => a - b);
  const lines = [...buildExpiredVoucherCleanupLines(valid), "/ip hotspot user profile"];

  for (const limit of limits) {
    const profile = userProfileName(limit);
    lines.push(
      `:do { :if ([:len [find name=${profile}]] = 0) do={ add name=${profile} shared-users=${limit} idle-timeout=none keepalive-timeout=none session-timeout=0s } else={ set [find name=${profile}] shared-users=${limit} idle-timeout=none keepalive-timeout=none session-timeout=0s } } on-error={}`,
    );
  }

  lines.push("/ip hotspot user");
  for (const voucher of valid) {
    const profile = userProfileName(voucher.limit);
    const mac =
      voucher.limit === 1 && voucher.bound_mac && isUsableMac(voucher.bound_mac)
        ? ` mac-address=${voucher.bound_mac}`
        : "";
    const user = `name="${voucher.code}" password="${voucher.code}" profile=${profile}${mac} comment="netgrid-voucher"`;
    lines.push(
      `:if ([:len [find where name="${voucher.code}"]] = 0) do={ :do { add ${user} server=netgrid-hs } on-error={ :do { add ${user} } on-error={} } }`,
    );
  }
  lines.push(...buildHotspotMacAuthLines(valid));
  return lines;
}

/** Disconnects active voucher sessions before removing the tenant's managed hotspot users. */
export function buildHotspotSuspendLines(): string[] {
  return [
    "/ip hotspot user",
    ':foreach u in=[find where comment="netgrid-voucher"] do={ :local n [get $u name]; :do { /ip hotspot active remove [find where user=$n] } on-error={} }',
    ':do { remove [find where comment="netgrid-voucher"] } on-error={}',
  ];
}

/** Blocks common explicit customer SSH/VPN egress on NetGrid's managed customer subnets. */
export function buildCustomerEgressFilterLines(): string[] {
  const subnets = [
    { name: "hotspot", address: "10.5.50.0/24" },
    { name: "pppoe", address: "10.10.0.0/24" },
  ];
  const rules = subnets.flatMap(({ name, address }) => [
    `:do { add chain=forward src-address=${address} out-interface=ether1 protocol=tcp dst-port=22,1194,1723 action=drop place-before=0 comment="netgrid-egress-tcp-${name}" } on-error={ :log warning "NetGrid: customer TCP tunnel restriction failed (${name})" }`,
    `:do { add chain=forward src-address=${address} out-interface=ether1 protocol=udp dst-port=500,1194,1701,4500,51820 action=drop place-before=0 comment="netgrid-egress-udp-${name}" } on-error={ :log warning "NetGrid: customer UDP tunnel restriction failed (${name})" }`,
    `:do { add chain=forward src-address=${address} out-interface=ether1 protocol=gre action=drop place-before=0 comment="netgrid-egress-gre-${name}" } on-error={ :log warning "NetGrid: customer GRE restriction failed (${name})" }`,
    `:do { add chain=forward src-address=${address} out-interface=ether1 protocol=ipsec-esp action=drop place-before=0 comment="netgrid-egress-esp-${name}" } on-error={ :log warning "NetGrid: customer IPsec restriction failed (${name})" }`,
  ]);
  return [
    "/ip firewall filter",
    ':do { remove [find where comment~"^netgrid-egress-"] } on-error={}',
    ...rules,
  ];
}

/** Devices the tenant blocked: no hotspot access, and any running session is dropped at once. */
export function buildBlockLines(macs: string[]): string[] {
  const list = [...new Set(macs.filter(isUsableMac))];
  return [
    "/ip hotspot ip-binding",
    `:do { remove [find where comment="${BLOCK_COMMENT}"] } on-error={}`,
    ...list.flatMap((m) => [
      `:do { add mac-address=${m} type=blocked server=netgrid-hs comment="${BLOCK_COMMENT}" } on-error={}`,
      `:do { /ip hotspot active remove [find where mac-address=${m}] } on-error={}`,
    ]),
  ];
}

/**
 * Anti-tethering. Detection (address list of suspects) is always on; the TTL=1 rule that actually
 * stops sharing is added only when the router's block_tethering switch is on. Rules are rebuilt
 * each sync, so flipping the switch takes effect within 2 minutes.
 */
export function buildTetherLines(blockTethering: boolean): string[] {
  const lines = [
    "/ip firewall mangle",
    ':do { remove [find where comment~"^netgrid-ttl"] } on-error={}',
  ];
  for (const ttl of [63, 127]) {
    lines.push(
      `:do { add chain=prerouting in-interface=netgrid-lan ttl=equal:${ttl} action=add-src-to-address-list address-list=${TETHER_LIST} address-list-timeout=30m comment="netgrid-ttl-detect-${ttl}" } on-error={}`,
    );
  }
  if (blockTethering) {
    lines.push(
      ':do { add chain=postrouting out-interface=netgrid-lan action=change-ttl new-ttl=set:1 comment="netgrid-ttl-enforce" } on-error={}',
      ':if ([:len [/ip firewall mangle find where comment="netgrid-ttl-enforce"]] = 0) do={ :log warning "NetGrid: sharing-protection rule is NOT installed" }',
      // FastTrack skips the mangle table, so fast-tracked connections would not be covered.
      ':if ([:len [/ip firewall filter find where action=fasttrack-connection and disabled=no]] > 0) do={ :log warning "NetGrid: FastTrack is on, sharing protection cannot act on fast-tracked traffic" }',
    );
  }
  return lines;
}

// RouterOS code of the report script (written with plain "$"; escaped when emitted, see below).
const DEVICE_SCRIPT = `
:local d ""
:local n 0
:foreach h in=[/ip hotspot host find] do={
  :if ($n < ${MAX_DEVICES_PER_REPORT}) do={
    :do {
      :local m [/ip hotspot host get $h mac-address]
      :local mac [:tostr $m]
      :local ip [:tostr [/ip hotspot host get $h address]]
      :local au [:tostr [/ip hotspot host get $h authorized]]
      :local usr ""
      :local hn ""
      :local tt 0
      :local act [/ip hotspot active find where mac-address=$m]
      :if ([:len $act] > 0) do={ :set usr [/ip hotspot active get [:pick $act 0] user] }
      :do {
        :local ls [/ip dhcp-server lease find where mac-address=$m]
        :if ([:len $ls] > 0) do={
          # The customer's device chooses its own name, and "|" / ";" separate our fields, so only
          # plain characters are kept (otherwise a crafted name could forge extra device records).
          :local raw [/ip dhcp-server lease get [:pick $ls 0] host-name]
          :local lim [:len $raw]
          :if ($lim > 40) do={ :set lim 40 }
          :if ($lim > 0) do={
            :local max ($lim - 1)
            :for i from=0 to=$max do={
              :local j ($i + 1)
              :local c [:pick $raw $i $j]
              :if ($c ~ "^[A-Za-z0-9._ -]$") do={ :set hn ($hn . $c) }
            }
          }
        }
      } on-error={}
      :if ([:len [/ip firewall address-list find where list=${TETHER_LIST} and address=$ip]] > 0) do={ :set tt 1 }
      :set d ($d . $mac . "|" . $ip . "|" . $hn . "|" . $usr . "|" . $au . "|" . $tt . ";")
      :set n ($n + 1)
    } on-error={}
  }
}
:do { /tool fetch url="__URL__" http-method=post http-data=$d mode=https keep-result=no } on-error={ :log warning "NetGrid: device report failed" }
`;

const PUSH_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/api\/public\/router\/devices\/[A-Za-z0-9_-]+$/;

/**
 * Installs the report script and its 1-minute scheduler on the router. Because the sync script is
 * fetched every 5 minutes, routers that were provisioned before this feature existed pick it up
 * automatically. The scheduler is only created when missing: re-creating it on every sync would
 * keep resetting its timer.
 */
export function buildDeviceAgentLines(pushUrl: string): string[] {
  if (!PUSH_URL.test(pushUrl)) return [];
  // Variables are written as plain "$name" inside the braced source, exactly like the WAN, interface and
  // heartbeat scripts that have always worked. (An escaped "\$" is only valid inside a quoted string.)
  // Comment lines are for readers of this file only: keep them out of the script the router imports.
  const code = DEVICE_SCRIPT.split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  const source = code.replace("__URL__", pushUrl);
  return [
    "/system script",
    ":do { remove [find where name=netgrid-devices] } on-error={}",
    `:do { add name=netgrid-devices source={${source}} } on-error={}`,
    ':do { :if ([:len [/system scheduler find where name=netgrid-devices]] = 0) do={ /system scheduler add name=netgrid-devices interval=1m on-event="/system script run netgrid-devices" } else={ /system scheduler set [find where name=netgrid-devices] interval=1m } } on-error={}',
  ];
}
