import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  generateVoucherInventory,
  saveVoucherInventorySettings,
} from "@/lib/voucher-presync.functions";

const NONE = "__none__";

export function VoucherInventoryManager() {
  const { tenantId } = useAuth();
  const queryClient = useQueryClient();
  const [routerId, setRouterId] = useState(NONE);
  const [packageId, setPackageId] = useState(NONE);
  const [enabled, setEnabled] = useState(false);
  const [minimum, setMinimum] = useState("20");
  const [target, setTarget] = useState("100");
  const [maximum, setMaximum] = useState("500");
  const [batchSize, setBatchSize] = useState("100");

  const { data: routers = [] } = useQuery({
    queryKey: ["voucher-inventory-routers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routers")
        .select("id,name,vendor")
        .eq("vendor", "mikrotik")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: packages = [] } = useQuery({
    queryKey: ["voucher-inventory-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packages")
        .select("id,name,kind")
        .in("kind", ["hotspot", "voucher"])
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: settings = [] } = useQuery({
    queryKey: ["voucher-inventory-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voucher_inventory_settings")
        .select(
          "id,router_id,package_id,enabled,minimum_stock,target_stock,maximum_stock,batch_size",
        )
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const setting = useMemo(
    () => settings.find((row) => row.router_id === routerId && row.package_id === packageId),
    [settings, routerId, packageId],
  );

  useEffect(() => {
    setEnabled(setting?.enabled ?? false);
    setMinimum(String(setting?.minimum_stock ?? 20));
    setTarget(String(setting?.target_stock ?? 100));
    setMaximum(String(setting?.maximum_stock ?? 500));
    setBatchSize(String(setting?.batch_size ?? 100));
  }, [setting]);

  const { data: inventory } = useQuery({
    queryKey: ["voucher-inventory-counts", routerId, packageId],
    enabled: routerId !== NONE && packageId !== NONE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vouchers")
        .select("sync_status")
        .eq("router_id", routerId)
        .eq("package_id", packageId)
        .eq("status", "unused")
        .is("payment_id", null)
        .in("sync_status", ["pending", "available"]);
      if (error) throw error;
      return {
        available: (data ?? []).filter((row) => row.sync_status === "available").length,
        syncing: (data ?? []).filter((row) => row.sync_status === "pending").length,
      };
    },
    refetchInterval: 15_000,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (routerId === NONE || packageId === NONE) throw new Error("Choose a router and package.");
      const result = await saveVoucherInventorySettings({
        data: {
          routerId,
          packageId,
          enabled,
          minimumStock: Number(minimum),
          targetStock: Number(target),
          maximumStock: Number(maximum),
          batchSize: Number(batchSize),
        },
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      toast.success(
        enabled
          ? "Voucher pre-sync enabled for this router and package."
          : "Voucher pre-sync disabled.",
      );
      void queryClient.invalidateQueries({ queryKey: ["voucher-inventory-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["voucher-inventory-counts"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save voucher settings."),
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (!setting) throw new Error("Save and enable the settings first.");
      const result = await generateVoucherInventory({ data: { settingId: setting.id } });
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    onSuccess: (result) => {
      toast.success(
        result.created
          ? `Generated ${result.created} vouchers. Router synchronization is pending.`
          : "Stock is at or above the configured replenishment threshold.",
      );
      void queryClient.invalidateQueries({ queryKey: ["voucher-inventory-counts"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not generate vouchers."),
  });

  const hasSelection = routerId !== NONE && packageId !== NONE;
  const validLevels =
    Number.isInteger(Number(minimum)) &&
    Number.isInteger(Number(target)) &&
    Number.isInteger(Number(maximum)) &&
    Number.isInteger(Number(batchSize)) &&
    Number(minimum) <= Number(target) &&
    Number(target) <= Number(maximum);

  return (
    <section className="mb-6 rounded-xl border bg-card p-4">
      <div className="mb-4">
        <h2 className="font-semibold">Voucher pre-synchronization</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate vouchers ahead of purchase. They become assignable only after the selected
          MikroTik router confirms the user, password, and profile.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Router</Label>
          <Select value={routerId} onValueChange={setRouterId}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Choose a MikroTik router" />
            </SelectTrigger>
            <SelectContent>
              {routers.map((router) => (
                <SelectItem key={router.id} value={router.id}>
                  {router.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Hotspot package</Label>
          <Select value={packageId} onValueChange={setPackageId}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Choose a package" />
            </SelectTrigger>
            <SelectContent>
              {packages.map((pkg) => (
                <SelectItem key={pkg.id} value={pkg.id}>
                  {pkg.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="voucher-minimum">Minimum stock</Label>
          <Input
            id="voucher-minimum"
            className="mt-1"
            type="number"
            min="0"
            max="500"
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="voucher-target">Target stock</Label>
          <Input
            id="voucher-target"
            className="mt-1"
            type="number"
            min="1"
            max="500"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="voucher-maximum">Maximum stock</Label>
          <Input
            id="voucher-maximum"
            className="mt-1"
            type="number"
            min="1"
            max="500"
            value={maximum}
            onChange={(event) => setMaximum(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="voucher-batch">Batch size</Label>
          <Input
            id="voucher-batch"
            className="mt-1"
            type="number"
            min="1"
            max="500"
            value={batchSize}
            onChange={(event) => setBatchSize(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          Enable pre-sync for this router and package
        </label>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => save.mutate()}
            disabled={!hasSelection || !validLevels || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
          <Button
            onClick={() => generate.mutate()}
            disabled={!enabled || !setting || generate.isPending}
          >
            {generate.isPending ? "Generating…" : "Generate / replenish"}
          </Button>
        </div>
      </div>

      {hasSelection && (
        <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
          {inventory?.available ?? 0} available · {inventory?.syncing ?? 0} awaiting router
          confirmation
          {tenantId ? "" : " · Tenant context unavailable"}
        </p>
      )}
    </section>
  );
}
