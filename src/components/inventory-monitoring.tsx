import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { EmptyState, StatCard } from "@/components/dashboard-shell";
import {
  HealthBadge, timeAgo, useInventoryDevices, useRouterOptions, type InventoryDevice,
} from "@/components/inventory-shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { categoryLabel } from "@/lib/inventory";
import { deviceHealth } from "@/lib/inventory-monitor";
import { Activity, CheckCircle2, CircleHelp, WifiOff } from "lucide-react";

export function MonitoringTab() {
  const { data: devices, isLoading, dataUpdatedAt } = useInventoryDevices(30_000);
  const { data: routers } = useRouterOptions();
  const routerName = useMemo(() => new Map((routers ?? []).map((r) => [r.id, r.name])), [routers]);
  const [downOnly, setDownOnly] = useState(false);
  const [history, setHistory] = useState<InventoryDevice | null>(null);

  const monitored = useMemo(() => (devices ?? []).filter((d) => d.monitor_enabled), [devices]);
  const counts = useMemo(() => {
    const c = { up: 0, down: 0, unknown: 0 };
    for (const d of monitored) {
      const h = deviceHealth(d);
      if (h === "up") c.up++; else if (h === "down") c.down++; else c.unknown++;
    }
    return c;
  }, [monitored]);

  // Offline first, then waiting, then online
  const rows = useMemo(() => {
    const rank = { down: 0, unknown: 1, up: 2, not_monitored: 3 } as const;
    return monitored
      .filter((d) => !downOnly || deviceHealth(d) === "down")
      .sort((a, b) => rank[deviceHealth(a)] - rank[deviceHealth(b)] || a.name.localeCompare(b.name));
  }, [monitored, downOnly]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard icon={Activity} label="Monitored" value={String(monitored.length)} hint="Devices being checked" />
        <StatCard icon={CheckCircle2} label="Online" value={String(counts.up)} hint="Responding" />
        <StatCard icon={WifiOff} label="Offline" value={String(counts.down)} hint="Not responding" />
        <StatCard icon={CircleHelp} label="Waiting" value={String(counts.unknown)} hint="No recent report" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={downOnly ? "default" : "outline"} onClick={() => setDownOnly((v) => !v)}>Offline only</Button>
        <span className="text-xs text-muted-foreground">
          Updates automatically{dataUpdatedAt ? ` · refreshed ${timeAgo(new Date(dataUpdatedAt).toISOString())}` : ""}
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : monitored.length === 0 ? (
        <EmptyState
          title="No devices are being monitored"
          description="Open a device on the Devices tab, give it an IP address, switch on “Monitor this device” and choose the router that can reach it."
        />
      ) : rows.length === 0 ? (
        <EmptyState title="Everything is online" description="No monitored device is currently offline." />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Status</th><th className="px-4 py-2">Device</th><th className="px-4 py-2">IP</th>
                <th className="px-4 py-2">Checked by</th><th className="px-4 py-2">Latency</th><th className="px-4 py-2">Last seen online</th><th className="px-4 py-2">Last check</th>
                <th className="px-4 py-2 text-right">History</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="px-4 py-2"><HealthBadge device={d} /></td>
                  <td className="px-4 py-2">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{[categoryLabel(d.category), d.location].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{d.ip_address}</td>
                  <td className="px-4 py-2">{d.monitor_router_id ? routerName.get(d.monitor_router_id) ?? "Router" : "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{d.online && d.latency_ms != null ? `${d.latency_ms} ms` : "—"}</td>
                  <td className="px-4 py-2">{timeAgo(d.last_seen_at)}</td>
                  <td className="px-4 py-2">{timeAgo(d.last_checked_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="ghost" aria-label="Show history" onClick={() => setHistory(d)}><History className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Each device is pinged by the router you chose (every ~30 s) and the result is sent to the platform about once a minute.
        “Waiting” means no report in the last few minutes, for example while that router is offline.
      </p>

      {history && <EventsDialog device={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function EventsDialog({ device, onClose }: { device: InventoryDevice; onClose: () => void }) {
  const { data: events, isLoading } = useQuery({
    queryKey: ["inventory-device-events", device.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_device_events").select("*").eq("device_id", device.id).order("at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{device.name}: online / offline history</DialogTitle>
          <DialogDescription>Each time the device went offline or came back, newest first.</DialogDescription>
        </DialogHeader>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (events ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <span className={e.event === "up" ? "font-medium text-success" : "font-medium text-destructive"}>
                  {e.event === "up" ? "Back online" : "Went offline"}
                </span>
                <span className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
