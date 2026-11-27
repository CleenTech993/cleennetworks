import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Map, Network, Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { buildChainTree, type ChainTreeNode, type ChainableRouter } from "@/lib/router-chain";
import { planNetworkExpansion } from "@/lib/network-planner";

export const Route = createFileRoute("/tenant/network-planner")({
  component: NetworkPlannerPage,
});

function TopologyNode({ node }: { node: ChainTreeNode<ChainableRouter> }) {
  return (
    <li className="ml-4 border-l border-border pl-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Network className={`h-4 w-4 ${node.live ? "text-emerald-600" : "text-destructive"}`} />
        <span className="font-medium">{node.router.name}</span>
        <Badge variant={node.live ? "outline" : "destructive"}>
          {node.live ? "live" : "offline"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {node.branchClients} branch client{node.branchClients === 1 ? "" : "s"}
        </span>
      </div>
      {node.children.length > 0 && (
        <ul className="space-y-2">
          {node.children.map((child) => (
            <TopologyNode key={child.router.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NetworkPlannerPage() {
  const { tenantId } = useAuth();
  const [addedCustomers, setAddedCustomers] = useState("100");
  const [addedNodes, setAddedNodes] = useState("1");
  const [capacityPerNode, setCapacityPerNode] = useState("100");

  const plannerQuery = useQuery({
    queryKey: ["tenant-network-planner", tenantId],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [routersResult, customersResult] = await Promise.all([
        supabase
          .from("routers")
          .select(
            "id,name,status,management_status,parent_router_id,connected_clients_count,hotspot_clients_count,pppoe_clients_count,wireless_clients_count,auto_discovered,vendor,lan_ip,mac_address,last_heartbeat_at,last_seen_at,node_role",
          )
          .eq("tenant_id", tenantId!),
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId!)
          .eq("status", "active"),
      ]);
      if (routersResult.error) throw routersResult.error;
      if (customersResult.error) throw customersResult.error;
      return {
        routers: (routersResult.data ?? []) as ChainableRouter[],
        activeCustomers: customersResult.count ?? 0,
      };
    },
  });

  const routers = plannerQuery.data?.routers ?? [];
  const activeCustomers = plannerQuery.data?.activeCustomers ?? 0;
  const forest = buildChainTree(routers);
  const scenario = planNetworkExpansion(
    { activeCustomerCount: activeCustomers, existingNodeCount: routers.length },
    Number(addedCustomers),
    Number(addedNodes),
    Number(capacityPerNode),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Network Digital Twin & Expansion Planner"
        description="Topology planning from enrolled router relationships, active customer demand, and configurable capacity assumptions."
      />

      {plannerQuery.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading network topology…
        </p>
      ) : plannerQuery.isError ? (
        <section className="rounded-xl border border-destructive/30 bg-card p-4" role="alert">
          <p className="font-medium">Network planning data could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">{plannerQuery.error.message}</p>
        </section>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="rounded-xl border bg-card p-5">
              <div className="mb-5 flex items-center gap-2">
                <Map className="h-5 w-5 text-primary" aria-hidden="true" />
                <h2 className="font-semibold">Known network topology</h2>
              </div>
              {forest.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No enrolled network nodes are available for the digital twin.
                </p>
              ) : (
                <ul className="space-y-3">
                  {forest.map((node) => (
                    <TopologyNode key={node.router.id} node={node} />
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border bg-card p-5">
              <h2 className="font-semibold">Expansion scenario</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This is a planning estimate, not an RF coverage or link-capacity calculation.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <Label htmlFor="added-customers">Additional active customers</Label>
                  <Input
                    id="added-customers"
                    type="number"
                    min="0"
                    step="1"
                    value={addedCustomers}
                    onChange={(event) => setAddedCustomers(event.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="added-nodes">Additional nodes</Label>
                  <Input
                    id="added-nodes"
                    type="number"
                    min="0"
                    step="1"
                    value={addedNodes}
                    onChange={(event) => setAddedNodes(event.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="capacity-per-node">Assumed customers per node</Label>
                  <Input
                    id="capacity-per-node"
                    type="number"
                    min="1"
                    step="1"
                    value={capacityPerNode}
                    onChange={(event) => setCapacityPerNode(event.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="mt-5 rounded-xl border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span className="text-sm text-muted-foreground">Projected utilization</span>
                  </div>
                  <Badge
                    variant={
                      scenario.recommendation === "expand"
                        ? "destructive"
                        : scenario.recommendation === "watch"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {scenario.recommendation}
                  </Badge>
                </div>
                <p className="mt-3 text-3xl font-semibold">
                  {scenario.projectedUtilizationPercent}%
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {scenario.projectedCustomers} projected customers across {scenario.plannedNodes}{" "}
                  known node{scenario.plannedNodes === 1 ? "" : "s"}.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {scenario.remainingCapacity} estimated remaining client capacity.
                </p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
