import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { VoucherManager } from "@/components/voucher-manager";
import { VoucherInventoryManager } from "@/components/voucher-inventory-manager";
import { supabase } from "@/integrations/supabase/client";
import { countOnlineClients } from "@/lib/online-clients";
import { CONNECTED_WINDOW_MS } from "@/lib/pppoe-sessions";
import { isRouterLive } from "@/lib/router-health";
import { useTenantLabels } from "@/hooks/use-tenant-customization";

function formatRate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 bps";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbps`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} Kbps`;
  return `${Math.round(value)} bps`;
}

export const Route = createFileRoute("/tenant/hotspot")({ component: Hotspot });

function Hotspot() {
  const { labels } = useTenantLabels();
  const { data } = useQuery({
    queryKey: ["hotspot-overview"],
    queryFn: async () => {
      const now = Date.now();
      const [vouchers, devices, routers] = await Promise.all([
        supabase
          .from("vouchers")
          .select("id", { count: "exact", head: true })
          .or("payment_id.not.is.null,status.eq.used,bound_mac.not.is.null"),
        supabase
          .from("router_devices")
          .select("mac,router_id,authorized,blocked,last_seen_at,download_bps,upload_bps")
          .eq("authorized", true)
          .eq("blocked", false)
          .gte("last_seen_at", new Date(now - CONNECTED_WINDOW_MS).toISOString()),
        supabase.from("routers").select("id,last_heartbeat_at,last_seen_at,hotspot_clients_count"),
      ]);
      if (vouchers.error) throw vouchers.error;
      if (devices.error) throw devices.error;
      if (routers.error) throw routers.error;

      const online = countOnlineClients({
        routers: routers.data ?? [],
        customers: [],
        hotspotDevices: devices.data ?? [],
        now,
      }).onlineHotspot;
      const liveRouterIds = new Set(
        (routers.data ?? []).filter(isRouterLive).map((router) => router.id),
      );
      const onlineDevices = (devices.data ?? []).filter((device) =>
        liveRouterIds.has(device.router_id),
      );
      const hotspotDownloadBps = onlineDevices.reduce(
        (sum, device) => sum + Number(device.download_bps ?? 0),
        0,
      );
      const hotspotUploadBps = onlineDevices.reduce(
        (sum, device) => sum + Number(device.upload_bps ?? 0),
        0,
      );
      const metrics =
        liveRouterIds.size > 0
          ? await supabase
              .from("router_metrics")
              .select("router_id,rx_bps,tx_bps,ts")
              .in("router_id", [...liveRouterIds])
              .gte("ts", new Date(now - 15 * 60_000).toISOString())
              .not("rx_bps", "is", null)
              .not("tx_bps", "is", null)
              .order("ts", { ascending: false })
          : { data: [], error: null };
      if (metrics.error) throw metrics.error;

      const latestMetricByRouter = new Map<
        string,
        { rx_bps: number | null; tx_bps: number | null }
      >();
      for (const metric of metrics.data ?? []) {
        if (!latestMetricByRouter.has(metric.router_id)) {
          latestMetricByRouter.set(metric.router_id, {
            rx_bps: metric.rx_bps,
            tx_bps: metric.tx_bps,
          });
        }
      }
      const wanDownloadBps = [...latestMetricByRouter.values()].reduce(
        (sum, metric) => sum + Number(metric.rx_bps ?? 0),
        0,
      );
      const wanUploadBps = [...latestMetricByRouter.values()].reduce(
        (sum, metric) => sum + Number(metric.tx_bps ?? 0),
        0,
      );
      return {
        online,
        issuedVouchers: vouchers.count ?? 0,
        totalDownloadBps: hotspotDownloadBps || wanDownloadBps,
        totalUploadBps: hotspotUploadBps || wanUploadBps,
        downloadSource: hotspotDownloadBps > 0 ? "hotspot" : "wan",
        uploadSource: hotspotUploadBps > 0 ? "hotspot" : "wan",
      };
    },
    refetchInterval: 10_000,
  });

  return (
    <div>
      <PageHeader
        title={labels.hotspot}
        description="Active hotspot users, legacy vouchers and live sessions."
      />
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Online now" value={data?.online ?? "—"} />
        <StatCard
          label="Issued vouchers"
          value={data?.issuedVouchers ?? "—"}
          hint="Paid or used; unassigned stock excluded"
        />
        <StatCard
          label="Download (live)"
          value={data ? formatRate(data.totalDownloadBps) : "—"}
          hint={
            data?.downloadSource === "hotspot"
              ? "Per-client hotspot traffic"
              : "Router WAN fallback (not hotspot-only)"
          }
        />
        <StatCard
          label="Upload (live)"
          value={data ? formatRate(data.totalUploadBps) : "—"}
          hint={
            data?.uploadSource === "hotspot"
              ? "Per-client hotspot traffic"
              : "Router WAN fallback (not hotspot-only)"
          }
        />
      </div>
      <div className="mt-6">
        <VoucherInventoryManager />
        <VoucherManager />
      </div>
    </div>
  );
}
