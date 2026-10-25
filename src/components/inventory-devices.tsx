import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/dashboard-shell";
import {
  HealthBadge, NONE, useCustomerOptions, useInventoryDevices, useInventoryItems, useRouterOptions,
  type InventoryDevice,
} from "@/components/inventory-shared";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  categoryLabel, customerLabel, DEVICE_CATEGORIES, DEVICE_STATUSES, describeError, isValidIpv4, normalizeMac, statusLabel,
} from "@/lib/inventory";

type Form = {
  name: string; category: string; brand: string; model: string; serial_number: string; mac_address: string;
  ip_address: string; status: string; customer_id: string; location: string; notes: string;
  item_id: string; take_stock: boolean; monitor_enabled: boolean; monitor_router_id: string;
};
const EMPTY: Form = {
  name: "", category: "access_point", brand: "", model: "", serial_number: "", mac_address: "", ip_address: "",
  status: "deployed", customer_id: NONE, location: "", notes: "", item_id: NONE, take_stock: true,
  monitor_enabled: false, monitor_router_id: NONE,
};

const blank = (s: string) => (s.trim() === "" ? null : s.trim());

function validate(f: Form): string | null {
  if (!f.name.trim()) return "Give the device a name.";
  if (f.ip_address.trim() && !isValidIpv4(f.ip_address)) return "That IP address isn't valid (use e.g. 192.168.88.20).";
  if (f.mac_address.trim() && !normalizeMac(f.mac_address)) return "That MAC address isn't valid (use e.g. AA:BB:CC:DD:EE:FF).";
  if (f.monitor_enabled && !f.ip_address.trim()) return "Monitoring needs the device's IP address.";
  if (f.monitor_enabled && f.monitor_router_id === NONE) return "Choose the router that will check this device.";
  return null;
}

/** Only the columns browsers may write (readings like "online" are written by the platform). */
function toPayload(f: Form) {
  return {
    name: f.name.trim(), category: f.category, brand: blank(f.brand), model: blank(f.model),
    serial_number: blank(f.serial_number), mac_address: f.mac_address.trim() ? normalizeMac(f.mac_address) : null,
    ip_address: blank(f.ip_address), status: f.status, customer_id: f.customer_id === NONE ? null : f.customer_id,
    location: blank(f.location), notes: blank(f.notes), item_id: f.item_id === NONE ? null : f.item_id,
    monitor_enabled: f.monitor_enabled, monitor_router_id: f.monitor_enabled && f.monitor_router_id !== NONE ? f.monitor_router_id : null,
  };
}

function fromDevice(d: InventoryDevice): Form {
  return {
    name: d.name, category: d.category, brand: d.brand ?? "", model: d.model ?? "", serial_number: d.serial_number ?? "",
    mac_address: d.mac_address ?? "", ip_address: d.ip_address ?? "", status: d.status, customer_id: d.customer_id ?? NONE,
    location: d.location ?? "", notes: d.notes ?? "", item_id: d.item_id ?? NONE, take_stock: false,
    monitor_enabled: d.monitor_enabled, monitor_router_id: d.monitor_router_id ?? NONE,
  };
}

export function DevicesTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const { data: devices, isLoading } = useInventoryDevices();
  const { data: customers } = useCustomerOptions();
  const customerById = useMemo(() => new Map((customers ?? []).map((c) => [c.id, c])), [customers]);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [assignment, setAssignment] = useState("all");
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; device: InventoryDevice } | null>(null);
  const [deleting, setDeleting] = useState<InventoryDevice | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (devices ?? []).filter((d) => {
      if (category !== "all" && d.category !== category) return false;
      if (status !== "all" && d.status !== status) return false;
      if (assignment === "assigned" && !d.customer_id) return false;
      if (assignment === "unassigned" && d.customer_id) return false;
      if (!q) return true;
      const cust = d.customer_id ? customerLabel(customerById.get(d.customer_id) ?? { id: d.customer_id, full_name: null, phone: null, pppoe_username: null }) : "";
      return [d.name, d.brand, d.model, d.serial_number, d.mac_address, d.ip_address, d.location, cust]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [devices, search, category, status, assignment, customerById]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("inventory_devices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Device deleted"); setDeleting(null); qc.invalidateQueries({ queryKey: ["inventory-devices"] }); },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-full sm:w-64" placeholder="Search name, serial, MAC, IP, customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {DEVICE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {DEVICE_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={assignment} onValueChange={setAssignment}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All equipment</SelectItem>
            <SelectItem value="assigned">With customers</SelectItem>
            <SelectItem value="unassigned">Not with a customer</SelectItem>
          </SelectContent>
        </Select>
        {canWrite && (
          <Button className="ml-auto" onClick={() => setDialog({ mode: "create" })}><Plus className="h-4 w-4" /> Add device</Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (devices ?? []).length === 0 ? (
        <EmptyState title="No devices yet" description="Register your routers, ONTs, access points and switches to track them, assign them to customers and monitor them." />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing matches" description="Try a different search or filter." />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Device</th><th className="px-4 py-2">Serial / MAC</th><th className="px-4 py-2">IP</th>
                <th className="px-4 py-2">Status</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Monitoring</th>
                {canWrite && <th className="px-4 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const c = d.customer_id ? customerById.get(d.customer_id) : null;
                return (
                  <tr key={d.id} className="border-t align-top">
                    <td className="px-4 py-2">
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-muted-foreground">{[categoryLabel(d.category), d.brand, d.model].filter(Boolean).join(" · ")}</div>
                      {d.location && <div className="text-xs text-muted-foreground">{d.location}</div>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      <div>{d.serial_number ?? "—"}</div><div className="text-muted-foreground">{d.mac_address ?? ""}</div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{d.ip_address ?? "—"}</td>
                    <td className="px-4 py-2"><Badge variant={d.status === "faulty" ? "destructive" : "secondary"}>{statusLabel(d.status)}</Badge></td>
                    <td className="px-4 py-2">{d.customer_id ? (c ? customerLabel(c) : "Customer") : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-2"><HealthBadge device={d} /></td>
                    {canWrite && (
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" aria-label="Edit device" onClick={() => setDialog({ mode: "edit", device: d })}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" aria-label="Delete device" onClick={() => setDeleting(d)}><Trash2 className="h-4 w-4" /></Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <DeviceDialog
          key={dialog.mode === "edit" ? dialog.device.id : "new"}
          mode={dialog.mode}
          initial={dialog.mode === "edit" ? fromDevice(dialog.device) : EMPTY}
          deviceId={dialog.mode === "edit" ? dialog.device.id : null}
          tenantId={tenantId}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            for (const k of ["inventory-devices", "inventory-items", "stock-movements"]) qc.invalidateQueries({ queryKey: [k] });
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the device and its monitoring history. Stock levels are not changed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DeviceDialog({ mode, initial, deviceId, tenantId, onClose, onSaved }: {
  mode: "create" | "edit"; initial: Form; deviceId: string | null; tenantId: string | null | undefined;
  onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<Form>(initial);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const { data: customers } = useCustomerOptions();
  const { data: routers } = useRouterOptions();
  const { data: items } = useInventoryItems();
  const catalogue = (items ?? []).filter((i) => i.category !== "cable");

  const save = useMutation({
    mutationFn: async () => {
      const problem = validate(f);
      if (problem) throw new Error(problem);
      const payload = toPayload(f);

      if (mode === "edit" && deviceId) {
        const { error } = await supabase.from("inventory_devices").update(payload).eq("id", deviceId);
        if (error) throw error;
        return;
      }
      if (!tenantId) throw new Error("No tenant");

      // Optionally take one unit out of the catalogue stock first, so a stock shortage stops the save.
      const takeFromStock = f.take_stock && f.item_id !== NONE && f.status !== "in_stock";
      if (takeFromStock) {
        const { error } = await supabase.from("stock_movements").insert({
          tenant_id: tenantId, item_id: f.item_id, change: -1, reason: "issued",
          customer_id: payload.customer_id, note: `Registered ${payload.name}`,
        });
        if (error) throw error;
      }
      const { error } = await supabase.from("inventory_devices").insert({ tenant_id: tenantId, ...payload });
      if (error) {
        if (takeFromStock) {
          await supabase.from("stock_movements").insert({
            tenant_id: tenantId, item_id: f.item_id, change: 1, reason: "returned", note: "Device was not saved",
          });
        }
        throw error;
      }
    },
    onSuccess: () => { toast.success(mode === "edit" ? "Device updated" : "Device added"); onSaved(); },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit device" : "Add device"}</DialogTitle>
          <DialogDescription>Register one unit. Turn on monitoring to be told when it goes offline.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1"><Label>Name</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Tower A – AP 1" /></div>
            <div className="col-span-2 sm:col-span-1">
              <Label>Type</Label>
              <Select value={f.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEVICE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Brand</Label><Input value={f.brand} onChange={(e) => set("brand", e.target.value)} /></div>
            <div><Label>Model</Label><Input value={f.model} onChange={(e) => set("model", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Serial number</Label><Input value={f.serial_number} onChange={(e) => set("serial_number", e.target.value)} /></div>
            <div><Label>MAC address</Label><Input value={f.mac_address} onChange={(e) => set("mac_address", e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>IP address</Label><Input value={f.ip_address} onChange={(e) => set("ip_address", e.target.value)} placeholder="192.168.88.20" /></div>
            <div>
              <Label>Status</Label>
              <Select value={f.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEVICE_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Assigned to customer</Label>
            <Select value={f.customer_id} onValueChange={(v) => { set("customer_id", v); if (v !== NONE && f.status === "in_stock") set("status", "deployed"); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value={NONE}>Not assigned</SelectItem>
                {(customers ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{customerLabel(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Location</Label><Input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Site, pole, room…" /></div>

          {mode === "create" && catalogue.length > 0 && (
            <div className="rounded-md border p-3">
              <Label>Stock item (optional)</Label>
              <Select value={f.item_id} onValueChange={(v) => set("item_id", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not linked</SelectItem>
                  {catalogue.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({Number(i.quantity)} in stock)</SelectItem>)}
                </SelectContent>
              </Select>
              {f.item_id !== NONE && f.status !== "in_stock" && (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <Switch checked={f.take_stock} onCheckedChange={(v) => set("take_stock", v)} /> Take 1 unit out of stock
                </label>
              )}
            </div>
          )}

          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Monitor this device</p>
                <p className="text-xs text-muted-foreground">A router on the same network pings it every ~30 s and reports up/down.</p>
              </div>
              <Switch checked={f.monitor_enabled} onCheckedChange={(v) => set("monitor_enabled", v)} />
            </div>
            {f.monitor_enabled && (
              <div className="mt-3">
                <Label>Checked by router</Label>
                <Select value={f.monitor_router_id} onValueChange={(v) => set("monitor_router_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Choose a router" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Choose a router…</SelectItem>
                    {(routers ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">Pick a router that can reach the IP address above. The first result appears within a few minutes.</p>
              </div>
            )}
          </div>
          <div><Label>Notes</Label><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
