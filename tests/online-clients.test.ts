import { describe, expect, it } from "vitest";
import { CONNECTED_WINDOW_MS } from "../src/lib/pppoe-sessions";
import { countOnlineClients } from "../src/lib/online-clients";

const now = Date.UTC(2026, 10, 6, 12);
const recent = new Date(now - 60_000).toISOString();
const liveRouter = {
  id: "router-1",
  last_heartbeat_at: recent,
  last_seen_at: recent,
};

describe("countOnlineClients", () => {
  it("counts recent authorized hotspot devices and connected PPPoE subscriptions", () => {
    const counts = countOnlineClients({
      routers: [liveRouter],
      customers: [
        {
          customer_type: "pppoe",
          status: "active",
          expires_at: new Date(now + 60_000).toISOString(),
          last_seen_at: recent,
          router_id: "router-1",
          last_router_id: "router-1",
        },
      ],
      hotspotDevices: [
        {
          mac: "AA:BB:CC:DD:EE:01",
          router_id: "router-1",
          authorized: true,
          blocked: false,
          last_seen_at: recent,
        },
      ],
      now,
    });

    expect(counts).toEqual({ onlineHotspot: 1, onlinePppoe: 1 });
  });

  it("excludes stale reports, offline routers, blocked devices, and inactive subscriptions", () => {
    const offlineRouter = {
      ...liveRouter,
      last_heartbeat_at: new Date(now - 4 * 60_000).toISOString(),
    };
    const counts = countOnlineClients({
      routers: [liveRouter, offlineRouter],
      customers: [
        {
          customer_type: "pppoe",
          status: "suspended",
          expires_at: null,
          last_seen_at: recent,
          router_id: "router-1",
          last_router_id: "router-1",
        },
        {
          customer_type: "pppoe",
          status: "active",
          expires_at: null,
          last_seen_at: recent,
          router_id: "router-2",
          last_router_id: "router-2",
        },
        {
          customer_type: "pppoe",
          status: "active",
          expires_at: new Date(now - 1).toISOString(),
          last_seen_at: recent,
          router_id: "router-1",
          last_router_id: "router-1",
        },
      ],
      hotspotDevices: [
        {
          mac: "AA:BB:CC:DD:EE:01",
          router_id: "router-1",
          authorized: true,
          blocked: true,
          last_seen_at: recent,
        },
        {
          mac: "AA:BB:CC:DD:EE:02",
          router_id: "router-1",
          authorized: false,
          blocked: false,
          last_seen_at: recent,
        },
        {
          mac: "AA:BB:CC:DD:EE:03",
          router_id: "router-1",
          authorized: true,
          blocked: false,
          last_seen_at: new Date(now - CONNECTED_WINDOW_MS).toISOString(),
        },
        {
          mac: "AA:BB:CC:DD:EE:04",
          router_id: "router-2",
          authorized: true,
          blocked: false,
          last_seen_at: recent,
        },
      ],
      now,
    });

    expect(counts).toEqual({ onlineHotspot: 0, onlinePppoe: 0 });
  });

  it("counts a hotspot device once if it has recent reports from multiple routers", () => {
    const counts = countOnlineClients({
      routers: [liveRouter, { ...liveRouter, id: "router-2" }],
      customers: [],
      hotspotDevices: ["router-1", "router-2"].map((router_id) => ({
        mac: "AA:BB:CC:DD:EE:01",
        router_id,
        authorized: true,
        blocked: false,
        last_seen_at: recent,
      })),
      now,
    });

    expect(counts.onlineHotspot).toBe(1);
  });
});
