import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  HealthBadge,
  useInventoryDevices,
  useInventoryItems,
  type InventoryDevice,
} from "@/components/inventory-shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { categoryLabel, formatQty, statusLabel } from "@/lib/inventory";

/** customer id -> devices currently assigned to them */
export function useEquipmentByCustomer() {
  const { data } = useInventoryDevices();
  return useMemo(() => {
    const map = new Map<string, InventoryDevice[]>();
    for (const d of data ?? []) {
      if (!d.customer_id) continue;
      map.set(d.customer_id, [...(map.get(d.customer_id) ?? []), d]);
    }
    return map;
  }, [data]);
}

/** Everything a customer has from you: registered devices plus materials (e.g. cable) issued to them. */
export function CustomerEquipmentDialog({
  customer,
  devices,
  onClose,
}: {
  customer: { id: string; full_name: string | null };
  devices: InventoryDevice[];
  onClose: () => void;
}) {
  const { data: items } = useInventoryItems();
  const itemById = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);

  const { data: moves } = useQuery({
    queryKey: ["customer-stock-moves", customer.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("item_id,change")
        .eq("customer_id", customer.id)
        .in("reason", ["issued", "returned"]);
      if (error) throw error;
      return data;
    },
  });
  // net quantity per item still with the customer (issued minus returned)
  const materials = useMemo(() => {
    const net = new Map<string, number>();
    for (const m of moves ?? []) net.set(m.item_id, (net.get(m.item_id) ?? 0) - Number(m.change));
    return [...net.entries()]
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ item: itemById.get(id), q }));
  }, [moves, itemById]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Equipment: {customer.full_name ?? "Customer"}</DialogTitle>
          <DialogDescription>
            Devices registered to this customer and materials issued to them.
          </DialogDescription>
        </DialogHeader>

        <h4 className="text-sm font-medium">Devices</h4>
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No devices assigned.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {devices.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 p-3">
                <div>
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[categoryLabel(d.category), d.brand, d.model, statusLabel(d.status)]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {[d.serial_number, d.ip_address].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <HealthBadge device={d} />
              </li>
            ))}
          </ul>
        )}

        <h4 className="mt-2 text-sm font-medium">Materials issued</h4>
        {materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing issued.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {materials.map(({ item, q }, i) => (
              <li key={item?.id ?? i} className="flex justify-between p-3">
                <span>{item?.name ?? "Item"}</span>
                <span className="font-medium">{formatQty(q, item?.unit ?? "pcs")}</span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
