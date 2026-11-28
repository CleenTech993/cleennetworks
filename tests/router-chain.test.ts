import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => "portal.test" }));

import {
  buildChainAgentLines,
  buildChainNodeName,
  buildChainTree,
  computeConnectedClientsCount,
  inferChainNodeType,
  parseChainReport,
  wouldCreateChainCycle,
} from "@/lib/router-chain";
import { Route as ChainRoute } from "@/routes/api/public/router/chain.$token";
import { Route as HeartbeatRoute } from "@/routes/api/public/router/heartbeat.$token";
import { Route as SyncRoute } from "@/routes/api/public/router/sync.$token";
import { issueDeviceToken } from "@/lib/router-auth.server";

const T = "11111111-1111-1111-1111-111111111111";
const OTHER_T = "99999999-9999-9999-9999-999999999999";
const R_ROOT = "r1000000-0000-0000-0000-000000000001";
const R_CHILD = "r2000000-0000-0000-0000-000000000002";
const R_OTHER = "r3000000-0000-0000-0000-000000000003";

describe("router-chain pure helpers", () => {
  it("parses valid neighbor records and drops invalid/multicast MACs", () => {
    const parsed = parseChainReport(
      [
        "aa-bb-cc-dd-ee-02|10.5.50.2/24|AP-North|MikroTik|cAP ax|7.15|ether2|1|14",
        "01:00:5e:00:00:01|10.5.50.3|multicast|x|y|1|ether3|1|0",
        "not-a-mac|10.5.50.4|bad|x|y|1|ether3|1|0",
        "AA:BB:CC:DD:EE:02|10.5.50.9|dup|x|y|1|ether3|0|0",
        "aa:bb:cc:dd:ee:04|10.5.50.5|Tower-Relay|MikroTik|hEX|7.14|ether4|0|3",
      ].join(";"),
    );

    expect(parsed).toEqual([
      {
        mac: "AA:BB:CC:DD:EE:02",
        ip: "10.5.50.2",
        identity: "AP-North",
        platform: "MikroTik",
        board: "cAP ax",
        version: "7.15",
        iface: "ether2",
        reachable: true,
        clientCount: 14,
      },
      {
        mac: "AA:BB:CC:DD:EE:04",
        ip: "10.5.50.5",
        identity: "Tower-Relay",
        platform: "MikroTik",
        board: "hEX",
        version: "7.14",
        iface: "ether4",
        reachable: false,
        clientCount: 3,
      },
    ]);
  });

  it("infers router vs access point role and vendor from discovery metadata", () => {
    expect(
      inferChainNodeType({ identity: "AP-Lobby", platform: "MikroTik", board: "cAP ac" }),
    ).toEqual({ nodeRole: "access_point", vendor: "mikrotik" });
    expect(
      inferChainNodeType({ identity: "EAP225-Outdoor", platform: "TP-Link", board: "EAP225" }),
    ).toEqual({ nodeRole: "access_point", vendor: "tp_link_omada" });
    expect(
      inferChainNodeType({ identity: "Core-Relay", platform: "MikroTik", board: "RB750Gr3" }),
    ).toEqual({ nodeRole: "router", vendor: "mikrotik" });
    expect(
      inferChainNodeType({ identity: "UniFi-Mesh", platform: "Ubiquiti", board: "UAP-AC-M" }),
    ).toEqual({ nodeRole: "access_point", vendor: "ubiquiti" });
  });

  it("builds friendly names and computes client counts without double-counting", () => {
    expect(
      buildChainNodeName({
        identity: "MikroTik",
        board: "cAP ax",
        mac: "AA:BB:CC:DD:EE:02",
        nodeRole: "access_point",
      }),
    ).toBe("cAP ax (EE:02)");
    expect(
      computeConnectedClientsCount({
        nodeRole: "router",
        hotspotClients: 8,
        pppoeClients: 4,
        wirelessClients: 5,
      }),
    ).toBe(12);
    expect(
      computeConnectedClientsCount({
        nodeRole: "access_point",
        hotspotClients: 0,
        pppoeClients: 0,
        wirelessClients: 9,
      }),
    ).toBe(9);
  });

  it("builds multi-level chain trees with branch client totals and offline ancestor tracking", () => {
    const now = Date.UTC(2026, 10, 25, 12);
    const recent = new Date(now - 30_000).toISOString();
    const stale = new Date(now - 10 * 60_000).toISOString();

    const forest = buildChainTree(
      [
        {
          id: "r1",
          name: "Core",
          node_role: "router",
          parent_router_id: null,
          status: "online",
          last_heartbeat_at: stale,
          last_seen_at: stale,
          connected_clients_count: 5,
        },
        {
          id: "r2",
          name: "Relay",
          node_role: "router",
          parent_router_id: "r1",
          status: "online",
          last_heartbeat_at: stale,
          last_seen_at: stale,
          connected_clients_count: 10,
        },
        {
          id: "ap1",
          name: "AP-East",
          node_role: "access_point",
          parent_router_id: "r2",
          status: "online",
          last_heartbeat_at: recent,
          last_seen_at: recent,
          connected_clients_count: 7,
        },
      ],
      now,
    );

    expect(forest).toHaveLength(1);
    expect(forest[0]!.live).toBe(false);
    expect(forest[0]!.branchClients).toBe(22);
    expect(forest[0]!.children[0]!.offlineAncestorName).toBe("Core");
    expect(forest[0]!.children[0]!.children[0]!.offlineAncestorName).toBe("Core");
  });

  it("detects chain cycles cleanly", () => {
    const routers = [
      { id: "a", parent_router_id: null },
      { id: "b", parent_router_id: "a" },
      { id: "c", parent_router_id: "b" },
    ];
    expect(wouldCreateChainCycle(routers, "a", "a")).toBe(true);
    expect(wouldCreateChainCycle(routers, "a", "c")).toBe(true);
    expect(wouldCreateChainCycle(routers, "c", "a")).toBe(false);
    expect(wouldCreateChainCycle(routers, "c", null)).toBe(false);
  });

  it("generates balanced RouterOS netgrid-chain script with no escaped dollars", () => {
    const lines = buildChainAgentLines(
      "https://portal.test/api/public/router/chain/TOK123456789012345",
    );
    const script = lines.join("\n");
    expect(script).toContain("netgrid-chain");
    expect(script).toContain('($iface != "ether1")');
    expect(script).toContain("($n < 128)");
    expect(script).toContain('($p < 4) && ($ip != "")');
    expect(script).not.toMatch(/\\\$/);
  });

  it("polls manually registered non-MikroTik chain nodes by MAC and estimates bridge clients", () => {
    const script = buildChainAgentLines(
      "https://portal.test/api/public/router/chain/TOK123456789012345",
      [
        {
          name: 'Tenda "Tower"',
          vendor: "generic",
          node_role: "access_point",
          mac_address: "aa-bb-cc-dd-ee-05",
          lan_ip: "192.168.1.5",
          uplink_interface: "ether2",
        },
        {
          name: "duplicate",
          vendor: "generic",
          node_role: "router",
          mac_address: "AA:BB:CC:DD:EE:05",
          lan_ip: null,
          uplink_interface: null,
        },
      ],
    ).join("\n");

    expect(script).toContain(':local kMac "AA:BB:CC:DD:EE:05"');
    expect(script).toContain("mac-address=$kMac and local=no");
    expect(script).toContain("mac-address!=$kMac");
    expect(script).toContain("192.168.1.5");
    expect(script).toContain("|Tenda Tower|generic|");
    expect(script.match(/:local kMac "AA:BB:CC:DD:EE:05"/g)).toHaveLength(1);
    expect(script).not.toContain('Tenda "Tower"');
  });
});

describe("chain discovery, auto-MAC registration, offline updates, and client counts", () => {
  beforeEach(() => {
    h.db = new FakeDb()
      .seed("tenants", [
        { id: T, slug: "acme", name: "Acme ISP" },
        { id: OTHER_T, slug: "rival", name: "Rival" },
      ])
      .seed("routers", [
        {
          id: R_ROOT,
          tenant_id: T,
          name: "Core Router",
          vendor: "mikrotik",
          node_role: "router",
          mac_address: "AA:BB:CC:00:00:01",
          parent_router_id: null,
          auto_chain_discovery: true,
          status: "online",
          management_method: "routeros_agent",
          last_heartbeat_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          legacy_token_auth: false,
          connected_clients_count: 0,
        },
        {
          id: R_CHILD,
          tenant_id: T,
          name: "Existing Relay",
          vendor: "mikrotik",
          node_role: "router",
          mac_address: "AA:BB:CC:00:00:02",
          parent_router_id: null,
          auto_chain_discovery: true,
          status: "online",
          management_method: "routeros_agent",
          last_heartbeat_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          legacy_token_auth: false,
          connected_clients_count: 0,
        },
        {
          id: R_OTHER,
          tenant_id: OTHER_T,
          name: "Rival Router",
          vendor: "mikrotik",
          node_role: "router",
          mac_address: "AA:BB:CC:00:00:99",
          parent_router_id: null,
          status: "online",
          legacy_token_auth: false,
        },
      ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("auto-detects new MAC on chain, adds AP under upstream router, and records discovery alert", async () => {
    const token = await issueDeviceToken(R_ROOT);
    const res = await call(ChainRoute, "POST", {
      params: { token },
      rawBody: "aa-bb-cc-11-22-33|10.5.50.10|AP-Tower-2|MikroTik|cAP ac|7.15|ether2|1|11;",
      ip: freshIp(),
    });
    expect(res.status).toBe(200);

    const added = h.db.rows("routers").find((r) => r.mac_address === "AA:BB:CC:11:22:33");
    expect(added).toBeDefined();
    expect(added).toMatchObject({
      tenant_id: T,
      name: "AP-Tower-2",
      node_role: "access_point",
      vendor: "mikrotik",
      parent_router_id: R_ROOT,
      discovered_by_router_id: R_ROOT,
      uplink_interface: "ether2",
      auto_discovered: true,
      management_method: "chain_neighbor",
      status: "online",
      connected_clients_count: 11,
    });

    const alerts = h.db.rows("inventory_alerts");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      tenant_id: T,
      kind: "chain_node_discovered",
      router_id: added!.id,
    });
  });

  it("links an existing tenant router on the chain and does not leak across tenants", async () => {
    const token = await issueDeviceToken(R_ROOT);
    const res = await call(ChainRoute, "POST", {
      params: { token },
      // Includes Existing Relay MAC + Rival tenant's MAC (which should create a separate tenant-scoped record, never touch R_OTHER).
      rawBody: "AA:BB:CC:00:00:02|10.5.50.2|Existing Relay|MikroTik|RB750|7.15|ether3|1|4;",
      ip: freshIp(),
    });
    expect(res.status).toBe(200);

    const relay = h.db.rows("routers").find((r) => r.id === R_CHILD)!;
    expect(relay.parent_router_id).toBe(R_ROOT);
    expect(relay.uplink_interface).toBe("ether3");
    expect(h.db.rows("routers").find((r) => r.id === R_OTHER)!.parent_router_id).toBeNull();
  });

  it("marks a chained AP offline, opens downtime event, raises router_down alert, and recovers it later", async () => {
    const token = await issueDeviceToken(R_ROOT);
    // 1. Discover online
    await call(ChainRoute, "POST", {
      params: { token },
      rawBody: "AA:BB:CC:11:22:44|10.5.50.20|AP-Yard|TP-Link|EAP225|5.1|ether2|1|6;",
      ip: freshIp(),
    });
    const ap = h.db.rows("routers").find((r) => r.mac_address === "AA:BB:CC:11:22:44")!;
    expect(ap.status).toBe("online");

    // 2. Upstream reports AP unreachable
    await call(ChainRoute, "POST", {
      params: { token },
      rawBody: "AA:BB:CC:11:22:44|10.5.50.20|AP-Yard|TP-Link|EAP225|5.1|ether2|0|0;",
      ip: freshIp(),
    });
    expect(ap.status).toBe("offline");
    expect(h.db.rows("router_uptime_events")).toHaveLength(1);
    expect(h.db.rows("router_uptime_events")[0]!.ended_at).toBeUndefined();
    expect(
      h.db.rows("inventory_alerts").some((a) => a.kind === "router_down" && a.router_id === ap.id),
    ).toBe(true);

    // 3. Upstream reports AP reachable again
    await call(ChainRoute, "POST", {
      params: { token },
      rawBody: "AA:BB:CC:11:22:44|10.5.50.20|AP-Yard|TP-Link|EAP225|5.1|ether2|1|3;",
      ip: freshIp(),
    });
    expect(ap.status).toBe("online");
    expect(ap.connected_clients_count).toBe(3);
    expect(h.db.rows("router_uptime_events")[0]!.ended_at).toBeTruthy();
    expect(
      h.db.rows("inventory_alerts").some((a) => a.kind === "router_up" && a.router_id === ap.id),
    ).toBe(true);
  });

  it("heartbeat records router MAC, auto-chains via uplink-mac, and updates connected client counts", async () => {
    const childToken = await issueDeviceToken(R_CHILD);
    const res = await call(HeartbeatRoute, "POST", {
      params: { token: childToken },
      rawBody:
        "cpu=18&mem-free=128&mem-total=256&mac=aa-bb-cc-00-00-02&uplink-mac=AA:BB:CC:00:00:01&hotspot-clients=9&pppoe-clients=3&wireless-clients=4",
      ip: freshIp(),
    });
    expect(res.status).toBe(200);

    const relay = h.db.rows("routers").find((r) => r.id === R_CHILD)!;
    expect(relay.mac_address).toBe("AA:BB:CC:00:00:02");
    expect(relay.parent_router_id).toBe(R_ROOT);
    expect(relay.hotspot_clients_count).toBe(9);
    expect(relay.pppoe_clients_count).toBe(3);
    expect(relay.wireless_clients_count).toBe(4);
    expect(relay.connected_clients_count).toBe(12);
  });

  it("sync script installs netgrid-chain and sends MAC + client metrics in heartbeat", async () => {
    h.db.seed("routers", [
      {
        id: "r4000000-0000-0000-0000-000000000004",
        tenant_id: T,
        name: "Tenda Yard AP",
        vendor: "generic",
        node_role: "access_point",
        mac_address: "AA:BB:CC:00:00:04",
        parent_router_id: R_ROOT,
        management_method: "chain_neighbor",
        lan_ip: "192.168.10.4",
        uplink_interface: "ether3",
      },
    ]);
    const token = await issueDeviceToken(R_ROOT);
    const res = await call(SyncRoute, "GET", { params: { token }, ip: freshIp() });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain(`https://portal.test/api/public/router/chain/${token}`);
    expect(text).toContain("add name=netgrid-chain");
    expect(text).toContain("hotspot-clients=");
    expect(text).toContain("uplink-mac=");
    expect(text).toContain(':local kMac "AA:BB:CC:00:00:04"');
    expect(text).toContain("192.168.10.4");
    expect(text).toContain("|Tenda Yard AP|generic|");
    expect(text).not.toContain("as-value");
    expect(text).toContain(":local pr [/ping $ip count=1 interval=300ms]");
  });
});
