import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { VoucherManager } from "@/components/voucher-manager";
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
  const labels = useTenantLabels();
  const { data } = useQuery({
    queryKey: ["hotspot-overview"],
    queryFn: async () => {
      const now = Date.now();
      const [cust, devices, routers] = await Promise.all([
        supabase.from("customers").select("id,status").eq("customer_type", "hotspot"),
        supabase
          .from("router_devices")
          .select("mac,router_id,authorized,blocked,last_seen_at,download_bps,upload_bps")
          .eq("authorized", true)
          .eq("blocked", false)
          .gte("last_seen_at", new Date(now - CONNECTED_WINDOW_MS).toISOString()),
        supabase.from("routers").select("id,last_heartbeat_at,last_seen_at"),
      ]);
      if (cust.error) throw cust.error;
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
      const totalDownloadBps = onlineDevices.reduce(
        (sum, device) => sum + Number(device.download_bps ?? 0),
        0,
      );
      const totalUploadBps = onlineDevices.reduce(
        (sum, device) => sum + Number(device.upload_bps ?? 0),
        0,
      );
      return {
        online,
        hotspotCustomers: cust.data?.length ?? 0,
        activeCustomers: (cust.data ?? []).filter((c) => c.status === "active").length,
        totalDownloadBps,
        totalUploadBps,
      };
    },
    refetchInterval: 10_000,
  });

  return (
    <div>
      <PageHeader
        title={labels.hotspot}
        description="Active hotspot users, vouchers and live sessions."
      />
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Online now" value={data?.online ?? "—"} />
        <StatCard
          label="Hotspot customers"
          value={data?.hotspotCustomers ?? "—"}
          hint={`${data?.activeCustomers ?? 0} active`}
        />
        <StatCard
          label="Download (live)"
          value={data ? formatRate(data.totalDownloadBps) : "—"}
          hint="Router-sampled throughput"
        />
        <StatCard
          label="Upload (live)"
          value={data ? formatRate(data.totalUploadBps) : "—"}
          hint="Router-sampled throughput"
        />
      </div>
      <div className="mt-6">
        <VoucherManager />
      </div>
    </div>
  );
}
