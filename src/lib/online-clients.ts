import { isClientConnected } from "./pppoe-sessions";
import { isRouterLive } from "./router-health";

type OnlineRouter = {
  id: string;
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
  hotspot_clients_count?: number | null;
};

type OnlineCustomer = {
  customer_type: string | null;
  status: string;
  expires_at: string | null;
  last_seen_at: string | null;
  router_id: string | null;
  last_router_id: string | null;
};

type OnlineHotspotDevice = {
  mac: string;
  router_id: string;
  authorized: boolean;
  blocked: boolean;
  last_seen_at: string;
};

export function countOnlineClients({
  routers,
  customers,
  hotspotDevices,
  now = Date.now(),
}: {
  routers: OnlineRouter[];
  customers: OnlineCustomer[];
  hotspotDevices: OnlineHotspotDevice[];
  now?: number;
}) {
  const liveRouters = new Set(
    routers.filter((router) => isRouterLive(router, now)).map((r) => r.id),
  );
  const onlinePppoe = customers.filter((customer) => {
    const routerId = customer.last_router_id ?? customer.router_id;
    const expiry = customer.expires_at ? new Date(customer.expires_at).getTime() : Infinity;
    return (
      customer.customer_type === "pppoe" &&
      customer.status === "active" &&
      expiry > now &&
      isClientConnected(customer.last_seen_at, now) &&
      !!routerId &&
      liveRouters.has(routerId)
    );
  }).length;

  const onlineHotspotMacs = new Set(
    hotspotDevices
      .filter(
        (device) =>
          device.authorized &&
          !device.blocked &&
          isClientConnected(device.last_seen_at, now) &&
          liveRouters.has(device.router_id),
      )
      .map((device) => device.mac),
  );

  const onlineHotspot =
    onlineHotspotMacs.size ||
    routers
      .filter((router) => liveRouters.has(router.id))
      .reduce(
        (sum, router) => sum + Math.max(0, Number(router.hotspot_clients_count ?? 0) || 0),
        0,
      );

  return { onlineHotspot, onlinePppoe };
}
