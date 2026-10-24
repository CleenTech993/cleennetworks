import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { VoucherManager } from "@/components/voucher-manager";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tenant/hotspot")({ component: Hotspot });

function Hotspot() {
  const { data } = useQuery({
    queryKey: ["hotspot-overview"],
    queryFn: async () => {
      const [sess, cust] = await Promise.all([
        supabase.from("sessions").select("id,status,bytes_in,bytes_out").eq("status", "active"),
        supabase.from("customers").select("id,status").eq("customer_type", "hotspot"),
      ]);
      const active = sess.data ?? [];
      const totalDown = active.reduce((s, x) => s + Number(x.bytes_in ?? 0), 0);
      const totalUp = active.reduce((s, x) => s + Number(x.bytes_out ?? 0), 0);
      return {
        online: active.length,
        hotspotCustomers: cust.data?.length ?? 0,
        activeCustomers: (cust.data ?? []).filter((c) => c.status === "active").length,
        downMB: (totalDown / 1024 / 1024).toFixed(1),
        upMB: (totalUp / 1024 / 1024).toFixed(1),
      };
    },
  });

  return (
    <div>
      <PageHeader title="Hotspot" description="Active hotspot users, vouchers and live sessions." />
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Online now" value={data?.online ?? "—"} />
        <StatCard label="Hotspot customers" value={data?.hotspotCustomers ?? "—"} hint={`${data?.activeCustomers ?? 0} active`} />
        <StatCard label="Download (live)" value={data ? data.downMB + " MB" : "—"} />
        <StatCard label="Upload (live)" value={data ? data.upMB + " MB" : "—"} />
      </div>
      <div className="mt-6">
        <VoucherManager />
      </div>
    </div>
  );
}
