import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, ClipboardList, UserRound } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatTenantDate } from "@/lib/tenant-customization";
import { hasAnyRole } from "@/lib/permissions";
import { listTeam } from "@/lib/team.functions";

export const Route = createFileRoute("/tenant/tickets")({ component: Tickets });

const ASSIGNEE_ROLES = new Set(["tenant_admin", "technician", "support_staff"]);
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
type TicketPriority = (typeof PRIORITIES)[number];
const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

function isTicketPriority(value: string): value is TicketPriority {
  return PRIORITIES.some((priority) => priority === value);
}

function Tickets() {
  const { tenantId, user, roles } = useAuth();
  const qc = useQueryClient();
  const canCreateWorkOrders = hasAnyRole(roles, ["tenant_admin", "technician"]);
  const canAssignTickets = hasAnyRole(roles, ["tenant_admin"]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ subject: string; body: string; priority: TicketPriority }>({
    subject: "",
    body: "",
    priority: "normal",
  });

  const {
    data: assignees = [],
    isError: assigneesError,
    error: assigneesLoadError,
  } = useQuery({
    queryKey: ["ticket-assignees", tenantId],
    enabled: Boolean(tenantId && canAssignTickets),
    queryFn: async () => {
      const result = await listTeam();
      if (!result.ok) throw new Error(result.error);
      return result.members.filter((member) =>
        member.roles.some((role) => ASSIGNEE_ROLES.has(role)),
      );
    },
  });
  const assigneeNames = new Map(
    assignees.map((member) => [
      member.id,
      [member.first_name, member.last_name].filter(Boolean).join(" ") ||
        member.full_name ||
        member.email ||
        "Team member",
    ]),
  );

  const {
    data: tickets = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["tickets", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("id,tenant_id,customer_id,subject,body,status,priority,assigned_to,created_at")
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const {
    data: linkedWorkOrders = [],
    isError: workOrdersError,
    error: workOrdersLoadError,
  } = useQuery({
    queryKey: ["ticket-work-order-links", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("id,ticket_id,title")
        .eq("tenant_id", tenantId!)
        .not("ticket_id", "is", null);
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const { error } = await supabase
        .from("support_tickets")
        .insert({ tenant_id: tenantId, ...form });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ticket created");
      setOpen(false);
      setForm({ subject: "", body: "", priority: "normal" });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const createWorkOrder = useMutation({
    mutationFn: async (ticket: (typeof tickets)[number]) => {
      if (!user || !tenantId) throw new Error("Your session is unavailable. Sign in again.");
      const { error } = await supabase.from("work_orders").insert({
        tenant_id: tenantId,
        customer_id: ticket.customer_id,
        ticket_id: ticket.id,
        title: `Field visit: ${ticket.subject}`.slice(0, 160),
        description: ticket.body ?? "",
        assigned_to: roles.includes("technician") ? user.id : null,
        created_by: user.id,
      });
      if (error?.code === "23505") {
        throw new Error("This ticket already has a linked work order.");
      }
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Work order created and linked to ticket");
      await qc.invalidateQueries({ queryKey: ["ticket-work-order-links", tenantId] });
      await qc.invalidateQueries({ queryKey: ["tenant-work-orders", tenantId] });
    },
    onError: (createError: Error) => toast.error(createError.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("support_tickets").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });

  const setPriority = useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority: TicketPriority }) => {
      const { error } = await supabase.from("support_tickets").update({ priority }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not update ticket priority"),
  });

  const setAssignee = useMutation({
    mutationFn: async ({ id, assignedTo }: { id: string; assignedTo: string | null }) => {
      const { error } = await supabase
        .from("support_tickets")
        .update({ assigned_to: assignedTo })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not assign support ticket"),
  });

  return (
    <div>
      <PageHeader
        title="Support"
        description="Customer tickets and internal notes."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>New ticket</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New ticket</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Subject</Label>
                  <Input
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Details</Label>
                  <Textarea
                    rows={4}
                    value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="ticket-priority">Priority</Label>
                  <select
                    id="ticket-priority"
                    value={form.priority}
                    onChange={(e) => {
                      if (isTicketPriority(e.target.value)) {
                        setForm({ ...form, priority: e.target.value });
                      }
                    }}
                    className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {PRIORITY_LABEL[priority]}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  onClick={() => create.mutate()}
                  disabled={!form.subject || create.isPending}
                >
                  {create.isPending ? "Creating…" : "Create"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />
      {workOrdersError && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          Could not load linked work orders: {workOrdersLoadError.message}
        </p>
      )}
      {assigneesError && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          Could not load ticket assignees: {assigneesLoadError.message}
        </p>
      )}
      {isError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
        >
          Could not load support tickets: {error.message}
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading support tickets…</p>
      ) : !tickets.length ? (
        <EmptyState title="No tickets" description="Customer issues will appear here." />
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => {
            const workOrder = linkedWorkOrders.find((item) => item.ticket_id === t.id);
            return (
              <div key={t.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{t.subject}</h3>
                      <Badge
                        variant={
                          t.priority === "urgent" || t.priority === "high"
                            ? "destructive"
                            : "secondary"
                        }
                        className={t.priority === "low" ? "text-muted-foreground" : undefined}
                      >
                        {t.priority === "urgent" && (
                          <AlertCircle className="mr-1 h-3 w-3" aria-hidden="true" />
                        )}
                        {isTicketPriority(t.priority) ? PRIORITY_LABEL[t.priority] : "Normal"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{t.body}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatTenantDate(t.created_at)}
                    </p>
                  </div>
                  <select
                    value={t.status}
                    onChange={(e) => setStatus.mutate({ id: t.id, status: e.target.value })}
                    className="rounded-md border bg-background px-2 py-1 text-xs"
                  >
                    <option value="open">Open</option>
                    <option value="pending">Pending</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Priority</span>
                  <select
                    aria-label={`Set priority for ${t.subject}`}
                    value={isTicketPriority(t.priority) ? t.priority : "normal"}
                    disabled={setPriority.isPending}
                    onChange={(e) => {
                      if (isTicketPriority(e.target.value)) {
                        setPriority.mutate({ id: t.id, priority: e.target.value });
                      }
                    }}
                    className="rounded-md border bg-background px-2 py-1 text-xs"
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {PRIORITY_LABEL[priority]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                    Assigned to
                  </span>
                  {canAssignTickets ? (
                    <select
                      aria-label={`Assign ${t.subject}`}
                      value={t.assigned_to ?? ""}
                      disabled={setAssignee.isPending || assigneesError}
                      onChange={(e) =>
                        setAssignee.mutate({
                          id: t.id,
                          assignedTo: e.target.value || null,
                        })
                      }
                      className="rounded-md border bg-background px-2 py-1 text-xs"
                    >
                      <option value="">Unassigned</option>
                      {assignees.map((member) => (
                        <option key={member.id} value={member.id}>
                          {assigneeNames.get(member.id)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs">
                      {t.assigned_to
                        ? (assigneeNames.get(t.assigned_to) ?? "Support team member")
                        : "Unassigned"}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  {workOrder ? (
                    <Badge variant="outline" className="gap-1.5">
                      <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
                      Work order: {workOrder.title}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">No field work linked</span>
                  )}
                  {canCreateWorkOrders && !workOrder && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={createWorkOrder.isPending || t.status === "closed"}
                      onClick={() => createWorkOrder.mutate(t)}
                    >
                      <ClipboardList aria-hidden="true" />
                      Create work order
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
