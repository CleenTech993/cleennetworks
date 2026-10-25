// Device monitoring for inventory (access points, switches, ONTs, ...).
//
// The platform cannot reach devices on a customer's LAN, so a MikroTik router on that network does
// the checking and reports back:
//   * the router's sync script (every 2 min) keeps one /tool netwatch entry per monitored device
//     (netwatch pings all hosts concurrently in the background, so many devices are no problem);
//   * a small reporter script (every 1 min) reads each entry's up/down state and pushes
//     "<device id>~1~<rtt ms>" (up) / "<device id>~0" (down) to /api/public/router/devices/<token>.
//
// Pure functions (no env / DB) so they can be unit-tested.

export const MONITOR_SCRIPT_VERSION = "v1";
/** Each device is tagged on the router with this prefix in the netwatch comment. */
export const NETWATCH_PREFIX = "nginv:";
/** More than this per router is cut off (one report URL must stay short enough for RouterOS). */
export const MAX_DEVICES_PER_ROUTER = 150;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d{1,2})(\.(25[0-5]|2[0-4]\d|1?\d{1,2})){3}$/;

export type MonitorTarget = { id: string; ip_address: string | null };

/** Only well-formed id + IPv4 pairs reach the router script (they are written into RouterOS code). */
export function safeTargets(targets: MonitorTarget[]): { id: string; ip: string }[] {
  const seen = new Set<string>();
  const out: { id: string; ip: string }[] = [];
  for (const t of targets) {
    if (!t.ip_address || !UUID.test(t.id) || !IPV4.test(t.ip_address) || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ id: t.id.toLowerCase(), ip: t.ip_address });
    if (out.length >= MAX_DEVICES_PER_ROUTER) break;
  }
  return out;
}

// Reporter script body (stored on the router). Written for RouterOS 6.4x/7.x.
const REPORTER_SOURCE = [
  ":global ngInvUrl",
  ':local out ""',
  `:foreach n in=[/tool netwatch find where comment~"^${NETWATCH_PREFIX}"] do={`,
  "  :local c [/tool netwatch get $n comment]",
  "  :local s [/tool netwatch get $n status]",
  '  :if ($s = "up" || $s = "down") do={',
  "    :local v 0",
  '    :local rtt ""',
  '    :if ($s = "up") do={',
  "      :set v 1",
  "      :do {",
  "        :local h [/tool netwatch get $n host]",
  "        :local res [/ping $h count=1 as-value]",
  "        :if ([:len $res] > 0) do={",
  '          :local t [:tostr ($res->0->"time")]',
  '          :set rtt ("~" . [:tonum [:pick $t 0 [:find $t "ms"]]])',
  "        }",
  "      } on-error={}",
  "    }",
  `    :set out ($out . [:pick $c ${NETWATCH_PREFIX.length} [:len $c]] . "~" . $v . $rtt . ",")`,
  "    :if ([:len $out] > 1500) do={",
  '      :do { /tool fetch url=($ngInvUrl . "?r=" . $out) mode=https keep-result=no } on-error={}',
  '      :set out ""',
  "    }",
  "  }",
  "}",
  ":if ([:len $out] > 0) do={",
  '  :do { /tool fetch url=($ngInvUrl . "?r=" . $out) mode=https keep-result=no } on-error={ :log warning "NetGrid: device report failed" }',
  "}",
];

/**
 * Lines appended to the router sync script. Idempotent: it (re)defines the device list, installs the
 * reporter script + scheduler if missing (or older than this version), and aligns the netwatch entries
 * with the list. An empty list removes every NetGrid netwatch entry.
 */
export function buildDeviceMonitorLines(targets: MonitorTarget[], reportUrl: string): string[] {
  const list = safeTargets(targets);
  // Two parallel lists (ids / ips) built with :toarray, the same construct the smart-TV sync uses.
  const ids = list.map((t) => t.id).join(",");
  const ips = list.map((t) => t.ip).join(",");
  return [
    "# Inventory device monitoring",
    ":do {",
    `  :global ngInvUrl "${reportUrl}"`,
    `  :global ngInvIds [:toarray "${ids}"]`,
    `  :global ngInvIps [:toarray "${ips}"]`,
    // reporter script + scheduler (recreated when the version changes)
    `  :if ([:len [/system script find where name=netgrid-inventory comment="${MONITOR_SCRIPT_VERSION}"]] = 0) do={`,
    "    :do { /system script remove [find where name=netgrid-inventory] } on-error={}",
    `    /system script add name=netgrid-inventory comment="${MONITOR_SCRIPT_VERSION}" source={`,
    ...REPORTER_SOURCE.map((l) => `      ${l}`),
    "    }",
    "  }",
    "  :if ([:len [/system scheduler find where name=netgrid-inventory]] = 0) do={",
    '    /system scheduler add name=netgrid-inventory interval=1m on-event="/system script run netgrid-inventory"',
    "  }",
    // netwatch entries: drop stale ones, fix changed IPs, add missing ones
    `  :foreach n in=[/tool netwatch find where comment~"^${NETWATCH_PREFIX}"] do={`,
    "    :local c [/tool netwatch get $n comment]",
    `    :local id [:pick $c ${NETWATCH_PREFIX.length} [:len $c]]`,
    "    :local pos [:find $ngInvIds $id]",
    '    :if ([:typeof $pos] = "nil") do={',
    "      /tool netwatch remove $n",
    "    } else={",
    "      :local want ($ngInvIps->$pos)",
    "      :if ([:tostr [/tool netwatch get $n host]] != [:tostr $want]) do={ /tool netwatch set $n host=$want }",
    "    }",
    "  }",
    "  :foreach id in=$ngInvIds do={",
    `    :if ([:len [/tool netwatch find where comment=("${NETWATCH_PREFIX}" . $id)]] = 0) do={`,
    "      :local pos [:find $ngInvIds $id]",
    `      /tool netwatch add host=($ngInvIps->$pos) interval=30s timeout=2s comment=("${NETWATCH_PREFIX}" . $id)`,
    "    }",
    "  }",
    '} on-error={ :log warning "NetGrid: device monitor sync failed" }',
  ];
}

export type DeviceReading = { id: string; up: boolean; latencyMs: number | null };

/** Parses "<uuid>~1~12,<uuid>~0,..." from the router (the latency is optional). Malformed pieces are ignored. */
export function parseDeviceReport(raw: string | null, max = MAX_DEVICES_PER_ROUTER): DeviceReading[] {
  if (!raw) return [];
  const out: DeviceReading[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const [id, v, rtt] = part.split("~");
    if (!id || !UUID.test(id) || (v !== "0" && v !== "1")) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const ms = v === "1" && rtt !== undefined && /^\d{1,5}$/.test(rtt) ? Number(rtt) : null;
    out.push({ id: key, up: v === "1", latencyMs: ms !== null && ms <= 60000 ? ms : null });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * What changes when a router reports `up` for a device whose stored state is `prev`.
 * An event is recorded on every real transition, and when the very first reading is "down".
 */
export function planReading(prevOnline: boolean | null, up: boolean, nowIso: string, latencyMs: number | null = null) {
  const changed = prevOnline === null ? !up : prevOnline !== up;
  return {
    patch: {
      online: up,
      loss_pct: up ? 0 : 100,
      latency_ms: up ? latencyMs : null,
      last_checked_at: nowIso,
      ...(up ? { last_seen_at: nowIso } : {}),
      ...(prevOnline === null || prevOnline !== up ? { status_changed_at: nowIso } : {}),
    },
    event: changed ? (up ? ("up" as const) : ("down" as const)) : null,
  };
}

export const DEFAULT_DOWN_AFTER_MINUTES = 5;

/**
 * Decides whether this reading should raise an alert. An outage alerts only once it has lasted
 * `downAfterMin` minutes (so a reboot or a brief blip never sends an SMS), at most once per outage,
 * and a "back online" notice follows only if the outage alert was actually raised.
 * `prev` is the device's state BEFORE this reading is applied.
 */
export function planAlert(args: {
  prevOnline: boolean | null;
  statusChangedAt: string | null;
  alertedAt: string | null;
  up: boolean;
  nowMs: number;
  downAfterMin: number;
}): { alert: "down" | "up" | null; alertedAtPatch: "now" | "clear" | null } {
  const { prevOnline, statusChangedAt, alertedAt, up, nowMs, downAfterMin } = args;
  if (up) {
    // alerted_at is only ever set while a device is down, so it is cleared on any recovery.
    if (alertedAt) return { alert: "up", alertedAtPatch: "clear" };
    return { alert: null, alertedAtPatch: null };
  }
  if (prevOnline === false && !alertedAt && statusChangedAt) {
    const downForMs = nowMs - new Date(statusChangedAt).getTime();
    if (downForMs >= downAfterMin * 60_000) return { alert: "down", alertedAtPatch: "now" };
  }
  return { alert: null, alertedAtPatch: null };
}

/** A reading older than this is shown as "unknown" (the router stopped reporting, e.g. it is offline). */
export const STALE_AFTER_MS = 6 * 60 * 1000;

export type DeviceHealth = "up" | "down" | "unknown" | "not_monitored";

export function deviceHealth(
  d: { monitor_enabled: boolean; online: boolean | null; last_checked_at: string | null },
  now: number = Date.now(),
): DeviceHealth {
  if (!d.monitor_enabled) return "not_monitored";
  if (d.online === null || !d.last_checked_at) return "unknown";
  if (now - new Date(d.last_checked_at).getTime() > STALE_AFTER_MS) return "unknown";
  return d.online ? "up" : "down";
}
