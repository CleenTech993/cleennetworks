import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { deviceHealth, type DeviceHealth } from "@/lib/inventory-monitor";
import type { Tables } from "@/integrations/supabase/types";

export type InventoryItem = Tables<"inventory_items">;
export type InventoryDevice = Tables<"inventory_devices">;

export const NONE = "none"; // Radix Select cannot hold an empty-string value

export function useInventoryItems() {
  return useQuery({
    queryKey: ["inventory-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_items").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useInventoryDevices(refetchMs?: number) {
  return useQuery({
    queryKey: ["inventory-devices"],
    refetchInterval: refetchMs,
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_devices").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCustomerOptions() {
  return useQuery({
    queryKey: ["inventory-customer-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,full_name,phone,pppoe_username")
        .order("full_name", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });
}

export function useRouterOptions() {
  return useQuery({
    queryKey: ["inventory-router-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("routers").select("id,name").order("name");
      if (error) throw error;
      return data;
    },
  });
}

const HEALTH_LABEL: Record<DeviceHealth, string> = {
  up: "Online",
  down: "Offline",
  unknown: "Waiting for data",
  not_monitored: "Not monitored",
};

export function HealthBadge({ device }: { device: Pick<InventoryDevice, "monitor_enabled" | "online" | "last_checked_at"> }) {
  const h = deviceHealth(device);
  if (h === "up") return <Badge className="bg-success text-success-foreground">{HEALTH_LABEL[h]}</Badge>;
  if (h === "down") return <Badge variant="destructive">{HEALTH_LABEL[h]}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">{HEALTH_LABEL[h]}</Badge>;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
