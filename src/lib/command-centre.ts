import { isRouterLive } from "@/lib/router-health";

export type CommandRouter = {
  id: string;
  name: string;
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
};

export type CommandTicket = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
};

export type CommandWorkOrder = {
  id: string;
  title: string;
  status: string;
  priority: string;
  scheduled_at: string | null;
  created_at: string;
};

export type CommandInvoice = {
  id: string;
  invoice_number: string;
  amount: number;
  status: string;
  due_at: string;
};

export type CommandItem = {
  id: string;
  category: "network" | "support" | "field" | "billing";
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  score: number;
};

export function buildCommandCentreItems({
  routers,
  tickets,
  workOrders,
  invoices,
  now = new Date(),
}: {
  routers: readonly CommandRouter[];
  tickets: readonly CommandTicket[];
  workOrders: readonly CommandWorkOrder[];
  invoices: readonly CommandInvoice[];
  now?: Date;
}) {
  const items: CommandItem[] = [];
  const offlineRouters = routers.filter((router) => !isRouterLive(router, now.getTime()));
  if (offlineRouters.length > 0) {
    items.push({
      id: "network-offline",
      category: "network",
      severity: "critical",
      title: `${offlineRouters.length} router${offlineRouters.length === 1 ? "" : "s"} offline`,
      detail: "Recent heartbeat or check-in evidence is missing.",
      score: 100 + offlineRouters.length,
    });
  }

  const openTickets = tickets.filter(
    (ticket) => ticket.status !== "closed" && ticket.status !== "resolved",
  );
  const urgentTickets = openTickets.filter(
    (ticket) => ticket.priority === "urgent" || ticket.priority === "high",
  );
  if (urgentTickets.length > 0) {
    items.push({
      id: "support-priority",
      category: "support",
      severity: urgentTickets.some((ticket) => ticket.priority === "urgent")
        ? "critical"
        : "warning",
      title: `${urgentTickets.length} priority support ticket${urgentTickets.length === 1 ? "" : "s"}`,
      detail: "High or urgent tickets still require a response or resolution.",
      score: 80 + urgentTickets.length,
    });
  }

  const activeWorkOrders = workOrders.filter(
    (order) => order.status !== "completed" && order.status !== "cancelled",
  );
  const overdueWorkOrders = activeWorkOrders.filter((order) => {
    if (!order.scheduled_at) return false;
    const scheduled = new Date(order.scheduled_at).getTime();
    return Number.isFinite(scheduled) && scheduled < now.getTime();
  });
  if (overdueWorkOrders.length > 0) {
    items.push({
      id: "field-overdue",
      category: "field",
      severity: "warning",
      title: `${overdueWorkOrders.length} overdue work order${overdueWorkOrders.length === 1 ? "" : "s"}`,
      detail: "Scheduled field work has passed its assigned time.",
      score: 70 + overdueWorkOrders.length,
    });
  }

  const overdueInvoices = invoices.filter((invoice) => {
    if (invoice.status === "paid" || invoice.status === "cancelled") return false;
    const due = new Date(invoice.due_at).getTime();
    return Number.isFinite(due) && due < now.getTime();
  });
  if (overdueInvoices.length > 0) {
    const amount = overdueInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    items.push({
      id: "billing-overdue",
      category: "billing",
      severity: "warning",
      title: `${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? "" : "s"}`,
      detail: `${amount.toLocaleString()} in total recorded invoice value.`,
      score: 60 + overdueInvoices.length,
    });
  }

  if (items.length === 0) {
    items.push({
      id: "all-clear",
      category: "network",
      severity: "info",
      title: "No priority action detected",
      detail: "No offline routers or urgent open operational records were found.",
      score: 0,
    });
  }

  return items.sort((a, b) => b.score - a.score);
}
