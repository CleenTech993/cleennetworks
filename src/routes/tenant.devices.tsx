import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, RotateCcw, ShieldAlert, Smartphone, Tv } from "lucide-react";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { setDeviceBlocked, unbindVoucherDevice } from "@/lib/device.functions";

export const Route = createFileRoute("/tenant/devices")({ component: Devices });

// Routers report every 2 minutes, so a device is "online" if it was seen in the last 5.
const ONLINE_MS = 5 * 60 * 1000;

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129_600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

function Devices() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data: devices = [] } = useQuery({
    queryKey: ["router-devices"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("router_devices").select("*").order("last_seen_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: routers = [] } = useQuery({
    queryKey: ["devices-routers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("routers").select("id,name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const routerName = useMemo(() => new Map(routers.map((r) => [r.id, r.name])), [routers]);

  const isOnline = (d: (typeof devices)[number]) => Date.now() - new Date(d.last_seen_at).getTime() < ONLINE_MS;
  const counts = {
    online: devices.filter(isOnline).length,
    registered: devices.filter((d) => d.registered_kind).length,
    unknown: devices.filter((d) => !d.registered_kind && !d.blocked).length,
    tether: devices.filter((d) => d.tether_suspected).length,
    blocked: devices.filter((d) => d.blocked).length,
  };

  const shown = devices.filter((d) => {
    if (filter === "online" && !isOnline(d)) return false;
    if (filter === "registered" && !d.registered_kind) return false;
    if (filter === "unknown" && (d.registered_kind || d.blocked)) return false;
    if (filter === "tether" && !d.tether_suspected) return false;
    if (filter === "blocked" && !d.blocked) return false;
    const q = search.trim().toLowerCase();
    return !q || [d.mac, d.ip, d.hostname, d.voucher_code].some((v) => v?.toLowerCase().includes(q));
  });

  const block = useMutation({
    mutationFn: async (v: { mac: string; blocked: boolean }) => {
      const res = await setDeviceBlocked({ data: v });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: (_r, v) => {
      toast.success(v.blocked ? "Device blocked. The router applies it within about 2 minutes." : "Device unblocked");
      void qc.invalidateQueries({ queryKey: ["router-devices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const unbind = useMutation({
    mutationFn: async (code: string) => {
      const res = await unbindVoucherDevice({ data: { code } });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Voucher released. The customer can now log in from a new device.");
      void qc.invalidateQueries({ queryKey: ["router-devices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Devices"
        description="Every device seen on your hotspots. One package works on one device; sharing a connection from a phone is blocked."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Online now" value={counts.online} />
        <StatCard label="Registered" value={counts.registered} hint="Linked to a voucher or TV" />
        <StatCard label="Unknown" value={counts.unknown} hint="Not linked to anything" />
        <StatCard label="Tethering suspected" value={counts.tether} />
        <StatCard label="Blocked" value={counts.blocked} />
      </div>

      <div className="mt-6 rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h3 className="font-semibold">Devices</h3>
          <div className="flex gap-2">
            <Input placeholder="Search MAC, IP, name or code" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-60" />
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All devices</SelectItem>
                <SelectItem value="online">Online now</SelectItem>
                <SelectItem value="registered">Registered</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
                <SelectItem value="tether">Tethering suspected</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Device</th>
                <th className="px-4 py-2 text-left">MAC address</th>
                <th className="px-4 py-2 text-left">Router</th>
                <th className="px-4 py-2 text-left">Linked to</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Last seen</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const online = isOnline(d);
                return (
                  <tr key={d.id} className="border-t">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {d.registered_kind === "tv" ? <Tv className="h-4 w-4 text-muted-foreground" /> : <Smartphone className="h-4 w-4 text-muted-foreground" />}
                        <div>
                          <p className="font-medium">{d.hostname || "Unnamed device"}</p>
                          <p className="text-xs text-muted-foreground">{d.ip ?? "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{d.mac}</td>
                    <td className="px-4 py-2 text-muted-foreground">{routerName.get(d.router_id) ?? "—"}</td>
                    <td className="px-4 py-2">
                      {d.registered_kind === "tv" ? "Smart TV" : d.voucher_code ? <code className="font-mono tracking-wider">{d.voucher_code}</code> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {d.blocked ? <Badge variant="destructive">Blocked</Badge>
                          : d.registered_kind ? <Badge variant="success">Registered</Badge>
                          : <Badge variant="secondary">Unknown</Badge>}
                        {d.tether_suspected && <Badge variant="warning"><ShieldAlert className="mr-1 h-3 w-3" />Tethering suspected</Badge>}
                        {online && <Badge variant="outline">Online</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{ago(d.last_seen_at)}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        {d.registered_kind === "voucher" && d.voucher_code && (
                          <Button
                            size="sm" variant="outline" disabled={unbind.isPending}
                            title="Let the customer use this voucher on a different device"
                            onClick={() => { if (window.confirm(`Release voucher ${d.voucher_code} from this device?`)) unbind.mutate(d.voucher_code!); }}
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Reset
                          </Button>
                        )}
                        <Button
                          size="sm" variant={d.blocked ? "outline" : "destructive"} disabled={block.isPending}
                          onClick={() => block.mutate({ mac: d.mac, blocked: !d.blocked })}
                        >
                          <Ban className="h-3.5 w-3.5" /> {d.blocked ? "Unblock" : "Block"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    {devices.length === 0
                      ? "No devices reported yet. Routers send their device list every 2 minutes once they have synced."
                      : "No devices match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Unknown = seen on the hotspot but not linked to any voucher or paid TV (for example someone browsing the login page).
          Showing the latest 500 devices.
        </p>
      </div>
    </div>
  );
}
