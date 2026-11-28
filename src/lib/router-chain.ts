// Router & Access Point chaining, automatic MAC discovery, and chain topology helpers.
// Pure functions (no env / DB access) so they are unit-testable.

import { isUsableMac, normalizeMac } from "./tv";
import { isRouterLive } from "./router-health";
import type { DeviceVendor } from "./device-management";

export type ChainNodeRole = "router" | "access_point";
export type ChainVendor = DeviceVendor | "ubiquiti" | "generic";

export const MAX_CHAIN_NEIGHBORS_PER_REPORT = 128;
// Keep serial probes bounded on low-powered routers; neighbor discovery still reports all entries.
const MAX_CHAIN_PINGS_PER_REPORT = 4;

export interface ChainNeighborRecord {
  mac: string;
  ip: string | null;
  identity: string | null;
  platform: string | null;
  board: string | null;
  version: string | null;
  iface: string | null;
  reachable: boolean;
  clientCount: number | null;
}

export interface KnownChainNode {
  name: string;
  vendor: string | null;
  node_role: string | null;
  mac_address: string | null;
  lan_ip: string | null;
  uplink_interface: string | null;
}

function cleanText(raw: string | undefined, maxLen = 64): string | null {
  const v = (raw ?? "")
    .replace(/[^\w .:/()-]/g, "")
    .trim()
    .slice(0, maxLen);
  return v || null;
}

function cleanIp(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().split("/")[0]?.trim() ?? "";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(v)) return null;
  return v.split(".").every((o) => Number(o) <= 255) ? v : null;
}

function cleanInterface(raw: string | null): string | null {
  const iface = (raw ?? "").trim();
  return /^[A-Za-z0-9_. -]{1,48}$/.test(iface) ? iface : null;
}

/**
 * Parses neighbor/chain reports pushed by an upstream router:
 *   mac|ip|identity|platform|board|version|interface|reachable|client_count
 * Records are separated by ";" or newlines. Malformed or non-unicast MAC entries are dropped.
 */
export function parseChainReport(body: string): ChainNeighborRecord[] {
  const out: ChainNeighborRecord[] = [];
  const seen = new Set<string>();
  for (const rawRec of body.split(/;|\r?\n/)) {
    if (out.length >= MAX_CHAIN_NEIGHBORS_PER_REPORT) break;
    const rec = rawRec.trim();
    if (!rec) continue;
    const parts = rec.split("|");
    if (parts.length < 7 || parts.length > 9) continue;

    const mac = normalizeMac(parts[0] ?? "");
    if (!mac || !isUsableMac(mac) || seen.has(mac)) continue;
    seen.add(mac);

    const reachableRaw = (parts[7] ?? "1").trim().toLowerCase();
    const reachable = reachableRaw !== "0" && reachableRaw !== "false" && reachableRaw !== "down";

    const countRaw = (parts[8] ?? "").trim();
    let clientCount: number | null = null;
    if (/^\d{1,5}$/.test(countRaw)) {
      const n = Number(countRaw);
      if (Number.isFinite(n) && n >= 0 && n <= 10_000) clientCount = n;
    }

    out.push({
      mac,
      ip: cleanIp(parts[1]),
      identity: cleanText(parts[2], 64),
      platform: cleanText(parts[3], 64),
      board: cleanText(parts[4], 64),
      version: cleanText(parts[5], 48),
      iface: cleanText(parts[6], 48),
      reachable,
      clientCount,
    });
  }
  return out;
}

/** Infers whether a discovered neighbor is a router or an access point, and its vendor. */
export function inferChainNodeType(input: {
  identity?: string | null;
  platform?: string | null;
  board?: string | null;
  iface?: string | null;
}): { nodeRole: ChainNodeRole; vendor: ChainVendor } {
  const identity = (input.identity ?? "").toLowerCase();
  const platform = (input.platform ?? "").toLowerCase();
  const board = (input.board ?? "").toLowerCase();
  const iface = (input.iface ?? "").toLowerCase();
  const combined = `${identity} ${platform} ${board}`;

  let vendor: ChainVendor = "generic";
  if (
    /mikrotik|routeros/.test(combined) ||
    /\b(rb\d|crs|ccr|hap|cap|wap|lhg|disc|sxtsq)\b/.test(board)
  ) {
    vendor = "mikrotik";
  } else if (/omada|tp-?link|\beap\d|\btl-/.test(combined)) {
    vendor = "tp_link_omada";
  } else if (/ruijie|reyee|\brg-/.test(combined)) {
    vendor = "ruijie_reyee";
  } else if (/ubiquiti|unifi|\buap\b|\bu6\b|airmax|nanostation|litebeam|rocket/.test(combined)) {
    vendor = "ubiquiti";
  }

  const looksLikeAp =
    /\b(ap|wap|cap|eap|uap|u6|rap|access.?point|mesh|repeater|extender)\b/.test(combined) ||
    /(^|[-_])(ap|wap|cap|eap)([-_\d]|$)/.test(identity) ||
    /^(wlan|wifi)/.test(iface);

  const looksLikeRouter =
    /\b(router|gateway|ccr|rb\d{3,4}|hex|er\d|edgerouter|gw)\b/.test(combined) && !looksLikeAp;

  return {
    nodeRole: looksLikeAp ? "access_point" : looksLikeRouter ? "router" : "router",
    vendor,
  };
}

/** Picks a human-friendly name for an auto-discovered router or access point on the chain. */
export function buildChainNodeName(input: {
  identity?: string | null;
  board?: string | null;
  mac: string;
  nodeRole: ChainNodeRole;
}): string {
  const shortMac = input.mac.slice(-5);
  const id = input.identity?.trim();
  if (id && !/^mikrotik$/i.test(id)) {
    return id.slice(0, 80);
  }
  const board = input.board?.trim();
  if (board) {
    return `${board} (${shortMac})`.slice(0, 80);
  }
  return `${input.nodeRole === "access_point" ? "AP" : "Router"} (${shortMac})`;
}

/** Computes total connected clients from separate hotspot / PPPoE / wireless counters without double-counting. */
export function computeConnectedClientsCount(input: {
  nodeRole?: string | null;
  hotspotClients?: number | null;
  pppoeClients?: number | null;
  wirelessClients?: number | null;
}): number {
  const hotspot = Math.max(0, Math.trunc(Number(input.hotspotClients ?? 0) || 0));
  const pppoe = Math.max(0, Math.trunc(Number(input.pppoeClients ?? 0) || 0));
  const wireless = Math.max(0, Math.trunc(Number(input.wirelessClients ?? 0) || 0));
  if (input.nodeRole === "access_point") {
    return wireless > 0 ? wireless : hotspot + pppoe;
  }
  const authSessions = hotspot + pppoe;
  return authSessions > 0 ? authSessions : wireless;
}

export interface ChainableRouter {
  id: string;
  name: string;
  node_role?: string | null;
  parent_router_id?: string | null;
  uplink_interface?: string | null;
  mac_address?: string | null;
  status: string;
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
  connected_clients_count?: number | null;
  hotspot_clients_count?: number | null;
  pppoe_clients_count?: number | null;
  wireless_clients_count?: number | null;
  auto_discovered?: boolean | null;
  vendor?: string | null;
  wan_ip?: string | null;
  lan_ip?: string | null;
  public_ip?: string | null;
}

export interface ChainTreeNode<T extends ChainableRouter = ChainableRouter> {
  router: T;
  depth: number;
  live: boolean;
  offlineAncestorName: string | null;
  directClients: number;
  branchClients: number;
  children: ChainTreeNode<T>[];
}

/**
 * Organizes a tenant's routers and access points into root chains / trees.
 * Guarded against cycles and missing parents (orphans fall back to top-level roots).
 */
export function buildChainTree<T extends ChainableRouter>(
  routers: readonly T[],
  now = Date.now(),
): ChainTreeNode<T>[] {
  const byId = new Map(routers.map((r) => [r.id, r]));
  const childrenMap = new Map<string, T[]>();
  const roots: T[] = [];

  for (const r of routers) {
    const pid = r.parent_router_id;
    if (pid && pid !== r.id && byId.has(pid)) {
      const list = childrenMap.get(pid) ?? [];
      list.push(r);
      childrenMap.set(pid, list);
    } else {
      roots.push(r);
    }
  }

  const sortNodes = (list: T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));

  const visited = new Set<string>();

  function visit(router: T, depth: number, offlineAncestorName: string | null): ChainTreeNode<T> {
    visited.add(router.id);
    const live = isRouterLive(router, now);
    const nextOfflineAncestor = offlineAncestorName ?? (!live ? router.name : null);
    const rawChildren = sortNodes(childrenMap.get(router.id) ?? []).filter(
      (child) => !visited.has(child.id),
    );
    const children = rawChildren.map((child) => visit(child, depth + 1, nextOfflineAncestor));
    const directClients = Math.max(0, Number(router.connected_clients_count ?? 0) || 0);
    const branchClients =
      directClients + children.reduce((sum, child) => sum + child.branchClients, 0);
    return {
      router,
      depth,
      live,
      offlineAncestorName,
      directClients,
      branchClients,
      children,
    };
  }

  const forest = sortNodes(roots).map((root) => visit(root, 0, null));
  // If any cycle existed in malformed data, surface unvisited nodes as top-level roots.
  for (const r of sortNodes([...routers])) {
    if (!visited.has(r.id)) {
      forest.push(visit(r, 0, null));
    }
  }
  return forest;
}

/**
 * Returns true if selecting `candidateParentId` as parent of `routerId` would create a cycle.
 */
export function wouldCreateChainCycle(
  routers: readonly { id: string; parent_router_id?: string | null }[],
  routerId: string,
  candidateParentId: string | null | undefined,
): boolean {
  if (!candidateParentId) return false;
  if (candidateParentId === routerId) return true;
  const parentOf = new Map(routers.map((r) => [r.id, r.parent_router_id ?? null]));
  const seen = new Set<string>([routerId]);
  let cur: string | null = candidateParentId;
  while (cur) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

// RouterOS code (plain "$"; no "#" comment lines inside emitted body).
const CHAIN_AGENT_SCRIPT = `
:local d ""
:local n 0
:local p 0
__KNOWN_NODES__
:foreach nb in=[/ip neighbor find] do={
  :if ($n < ${MAX_CHAIN_NEIGHBORS_PER_REPORT}) do={
    :do {
      :local iface [:tostr [/ip neighbor get $nb interface]]
      :local iname [:tostr [/ip neighbor get $nb interface-name]]
      :if (($iface != "ether1") && ($iname != "ether1")) do={
        :local mac [:tostr [/ip neighbor get $nb mac-address]]
        :local ip [:tostr [/ip neighbor get $nb address]]
        :local id [:tostr [/ip neighbor get $nb identity]]
        :local plat [:tostr [/ip neighbor get $nb platform]]
        :local brd [:tostr [/ip neighbor get $nb board]]
        :local ver [:tostr [/ip neighbor get $nb version]]
        :local usedIf $iname
        :if ($usedIf = "") do={ :set usedIf $iface }
        :local reach 1
        :if (($p < ${MAX_CHAIN_PINGS_PER_REPORT}) && ($ip != "")) do={
          :set p ($p + 1)
          :do {
            :local pr [/ping $ip count=1 interval=300ms]
            :if ($pr = 0) do={ :set reach 0 }
          } on-error={}
        }
        :local cc ""
        :do {
          :if ($usedIf != "") do={
            :set cc [:tostr [:len [/interface bridge host find where on-interface=$usedIf and local=no]]]
          }
        } on-error={}
        :set d ($d . $mac . "|" . $ip . "|" . $id . "|" . $plat . "|" . $brd . "|" . $ver . "|" . $usedIf . "|" . $reach . "|" . $cc . ";")
        :set n ($n + 1)
        :if ([:len $d] > 3000) do={
          :do { /tool fetch url="__URL__" http-method=post http-data=$d mode=https keep-result=no } on-error={ :log warning "NetGrid: chain report failed" }
          :set d ""
        }
      }
    } on-error={}
  }
}
:if ([:len $d] > 0) do={
  :do { /tool fetch url="__URL__" http-method=post http-data=$d mode=https keep-result=no } on-error={ :log warning "NetGrid: chain report failed" }
}
`;

const CHAIN_PUSH_URL =
  /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/api\/public\/router\/chain\/[A-Za-z0-9_-]+$/;

/**
 * Installs the chain neighbor discovery & reachability script (`netgrid-chain`) and 1-minute scheduler.
 */
export function buildChainAgentLines(
  pushUrl: string,
  knownNodes: readonly KnownChainNode[] = [],
): string[] {
  if (!CHAIN_PUSH_URL.test(pushUrl)) return [];
  const seenMacs = new Set<string>();
  const knownNodeLines = knownNodes.slice(0, MAX_CHAIN_NEIGHBORS_PER_REPORT).flatMap((node) => {
    const mac = node.mac_address ? normalizeMac(node.mac_address) : null;
    if (!mac || seenMacs.has(mac)) return [];
    seenMacs.add(mac);

    const name = cleanText(node.name) ?? "Chain device";
    const vendor = cleanText(node.vendor ?? undefined) ?? "generic";
    const ip = cleanIp(node.lan_ip ?? undefined) ?? "";
    const iface = cleanInterface(node.uplink_interface) ?? "";

    return [
      `:do {
  :local kMac "${mac}"
  :if ([:len [/ip neighbor find where mac-address=$kMac]] = 0) do={
    :local kIp "${ip}"
    :local kIface "${iface}"
    :local kArp [/ip arp find where dynamic=yes and mac-address=$kMac]
    :if (([:len $kArp] > 0) && ($kIp = "")) do={ :set kIp [:tostr [/ip arp get [:pick $kArp 0] address]] }
    :if (([:len $kArp] > 0) && ($kIface = "")) do={ :set kIface [:tostr [/ip arp get [:pick $kArp 0] interface]] }
    :local kBridge [/interface bridge host find where mac-address=$kMac and local=no]
    :if (([:len $kBridge] > 0) && ($kIface = "")) do={ :set kIface [:tostr [/interface bridge host get [:pick $kBridge 0] on-interface]] }
    :local kReach 0
    :if (([:len $kArp] > 0) || ([:len $kBridge] > 0)) do={ :set kReach 1 }
    :if (($kReach = 0) && ($kIp != "") && ($p < ${MAX_CHAIN_PINGS_PER_REPORT})) do={
      :set p ($p + 1)
      :do {
        :local kPing [/ping $kIp count=1 interval=300ms]
        :if ($kPing > 0) do={ :set kReach 1 }
      } on-error={}
    }
    :local kClients ""
    :if (($kReach = 1) && ($kIface != "")) do={
      :set kClients [:tostr [:len [/interface bridge host find where on-interface=$kIface and local=no and mac-address!=$kMac]]]
    }
    :set d ($d . "${mac}|" . $kIp . "|${name}|${vendor}| | |" . $kIface . "|" . $kReach . "|" . $kClients . ";")
    :set n ($n + 1)
    :if ([:len $d] > 3000) do={
      :do { /tool fetch url="__URL__" http-method=post http-data=$d mode=https keep-result=no } on-error={ :log warning "NetGrid: chain report failed" }
      :set d ""
    }
  }
} on-error={}`,
    ];
  });
  const code = CHAIN_AGENT_SCRIPT.replace("__KNOWN_NODES__", knownNodeLines.join("\n"))
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  const source = code.replaceAll("__URL__", pushUrl);
  return [
    "/system script",
    ":do { remove [find where name=netgrid-chain] } on-error={}",
    `:do { add name=netgrid-chain source={${source}} } on-error={}`,
    ':do { :if ([:len [/system scheduler find where name=netgrid-chain]] = 0) do={ /system scheduler add name=netgrid-chain interval=1m on-event="/system script run netgrid-chain" } else={ /system scheduler set [find where name=netgrid-chain] interval=1m } } on-error={}',
  ];
}
