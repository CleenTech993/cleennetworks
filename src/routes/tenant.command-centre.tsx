import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  CreditCard,
  Radar,
  Ticket,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  buildCommandCentreItems,
  type CommandInvoice,
  type CommandRouter,
  type CommandTicket,
  type CommandWorkOrder,
} from "@/lib/command-centre";

export const Route = createFileRoute("/tenant/command-centre")({
  component: CommandCentrePage,
});

const categoryIcons = {
  network: Radar,
  support: Ticket,
  field: BriefcaseBusiness,
  billing: CreditCard,
};

function CommandCentrePage() {
  const { tenantId } = useAuth();
  const commandQuery = useQuery({
    queryKey: ["tenant-command-centre", tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [routers, tickets, workOrders, invoices] = await Promise.all([
        supabase
          .from("routers")
          .select("id,name,last_heartbeat_at,last_seen_at")
          .eq("tenant_id", tenantId!),
        supabase
          .from("support_tickets")
          .select("id,subject,status,priority,created_at")
          .eq("tenant_id", tenantId!)
          .limit(500),
        supabase
          .from("work_orders")
          .select("id,title,status,priority,scheduled_at,created_at")
          .eq("tenant_id", tenantId!)
          .limit(500),
        supabase
          .from("customer_invoices")
          .select("id,invoice_number,amount,status,due_at")
          .eq("tenant_id", tenantId!)
          .neq("status", "paid")
          .limit(500),
      ]);
      if (routers.error) throw routers.error;
      if (tickets.error) throw tickets.error;
      if (workOrders.error) throw workOrders.error;
      if (invoices.error) throw invoices.error;
      return {
        routers: (routers.data ?? []) as CommandRouter[],
        tickets: (tickets.data ?? []) as CommandTicket[],
        workOrders: (workOrders.data ?? []) as CommandWorkOrder[],
        invoices: (invoices.data ?? []) as CommandInvoice[],
      };
    },
  });

  const items = buildCommandCentreItems(
    commandQuery.data ?? {
      routers: [],
      tickets: [],
      workOrders: [],
      invoices: [],
    },
  );
  const criticalCount = items.filter((item) => item.severity === "critical").length;
  const warningCount = items.filter((item) => item.severity === "warning").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="NETGRID Command Centre"
        action={
          <Badge variant={criticalCount > 0 ? "destructive" : "outline"}>
            {criticalCount > 0 ? `${criticalCount} critical` : "Operational"}
          </Badge>
        }
        description="Priority operational view across network, support, field, and billing."
      />

      {commandQuery.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading command view…
        </p>
      ) : commandQuery.isError ? (
        <section className="rounded-xl border border-destructive/30 bg-card p-4" role="alert">
          <p className="font-medium">Command Centre could not load.</p>
          <p className="mt-1 text-sm text-muted-foreground">{commandQuery.error.message}</p>
        </section>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">Critical actions</p>
              <p className="mt-2 text-2xl font-semibold">{criticalCount}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">Warnings</p>
              <p className="mt-2 text-2xl font-semibold">{warningCount}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">Operational records</p>
              <p className="mt-2 text-2xl font-semibold">
                {(commandQuery.data?.tickets.length ?? 0) +
                  (commandQuery.data?.workOrders.length ?? 0)}
              </p>
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b p-4">
              <h2 className="font-semibold">Priority queue</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ranked from existing network, support, field, and invoice records.
              </p>
            </div>
            <div className="divide-y">
              {items.map((item) => {
                const Icon =
                  item.category === "network"
                    ? categoryIcons.network
                    : item.category === "support"
                      ? categoryIcons.support
                      : item.category === "field"
                        ? categoryIcons.field
                        : categoryIcons.billing;
                return (
                  <article
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-3 p-4"
                  >
                    <div className="flex gap-3">
                      {item.severity === "info" ? (
                        <CheckCircle2
                          className="mt-0.5 h-5 w-5 text-emerald-600"
                          aria-hidden="true"
                        />
                      ) : (
                        <AlertTriangle
                          className={`mt-0.5 h-5 w-5 ${
                            item.severity === "critical" ? "text-destructive" : "text-amber-600"
                          }`}
                          aria-hidden="true"
                        />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          <h3 className="font-medium">{item.title}</h3>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                      </div>
                    </div>
                    <Badge variant={item.severity === "critical" ? "destructive" : "outline"}>
                      {item.severity}
                    </Badge>
                  </article>
                );
              })}
            </div>
          </section>

          <div className="flex flex-wrap gap-3">
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              to="/tenant/noc"
            >
              Open NOC Monitor
            </Link>
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              to="/tenant/tickets"
            >
              Open support tickets
            </Link>
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              to="/tenant/work-orders"
            >
              Open work orders
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
