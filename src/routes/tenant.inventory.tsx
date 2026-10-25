import { createFileRoute } from "@tanstack/react-router";
import { Boxes, PackageX, Server, Users } from "lucide-react";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
import { DevicesTab } from "@/components/inventory-devices";
import { MonitoringTab } from "@/components/inventory-monitoring";
import { useInventoryDevices, useInventoryItems } from "@/components/inventory-shared";
import { StockTab } from "@/components/inventory-stock";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isLowStock } from "@/lib/inventory";
import { deviceHealth } from "@/lib/inventory-monitor";
import { hasAnyRole } from "@/lib/permissions";

export const Route = createFileRoute("/tenant/inventory")({ component: Inventory });

function Inventory() {
  const { roles } = Route.useRouteContext();
  // Support staff can look but not change anything (the database enforces the same rule).
  const canWrite = hasAnyRole(roles, ["tenant_admin", "technician"]);
  const { data: devices } = useInventoryDevices();
  const { data: items } = useInventoryItems();

  const offline = (devices ?? []).filter((d) => deviceHealth(d) === "down").length;
  const withCustomers = (devices ?? []).filter((d) => d.customer_id).length;
  const low = (items ?? []).filter(isLowStock).length;

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Track your routers, ONTs, access points, switches and cable: what's in stock, what's deployed, what each customer has, and whether it's online."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Server} label="Devices" value={devices ? devices.length : "—"} hint="Registered units" />
        <StatCard icon={Users} label="With customers" value={devices ? withCustomers : "—"} hint="Equipment assigned" />
        <StatCard icon={PackageX} label="Low stock" value={items ? low : "—"} hint="Items to reorder" />
        <StatCard icon={Boxes} label="Offline" value={devices ? offline : "—"} hint="Monitored devices down" />
      </div>

      <Tabs defaultValue="devices">
        <TabsList>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
        </TabsList>
        <TabsContent value="devices" className="mt-4"><DevicesTab canWrite={canWrite} /></TabsContent>
        <TabsContent value="stock" className="mt-4"><StockTab canWrite={canWrite} /></TabsContent>
        <TabsContent value="monitoring" className="mt-4"><MonitoringTab /></TabsContent>
      </Tabs>
    </div>
  );
}
