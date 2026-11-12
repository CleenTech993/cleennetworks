import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ClipboardList, MapPin, Plus, RefreshCw, UserRound, Wifi } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, StatCard } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { hasAnyRole } from "@/lib/permissions";
import { formatTenantDate } from "@/lib/tenant-customization";
import { listWorkOrderAssignees } from "@/lib/work-orders.functions";

export const Route = createFileRoute("/tenant/work-orders")({ component: WorkOrders });

type WorkOrderStatus = "open" | "scheduled" | "in_progress" | "completed" | "cancelled";
type Priority = "low" | "normal" | "high" | "urgent";

type WorkOrder = {
  id: string;
  title: string;
  description: string;
  status: WorkOrderStatus;
  priority: Priority;
  customer_id: string | null;
  assigned_to: string | null;
  scheduled_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  open: "Open",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

function WorkOrders() {
  const { tenantId, user, roles } = useAuth();
  const qc = useQueryClient();
  const canManage = hasAnyRole(roles, ["tenant_admin", "technician"]);
  const isAdmin = hasAnyRole(roles, ["tenant_admin"]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [completionOrder, setCompletionOrder] = useState<WorkOrder | null>(null);
  const [completionNotes, setCompletionNotes] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [form, setForm] = useState({
    title: "",
    description: "",
    customerId: "",
    assignedTo: "",
    scheduledAt: "",
    priority: "normal" as Priority,
  });

  const {
    data: workOrders = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["tenant-work-orders", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select(
          "id,title,description,status,priority,customer_id,assigned_to,scheduled_at,resolution_notes,created_at,updated_at",
        )
        .eq("tenant_id", tenantId!)
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(250);
      if (error) throw error;
      return data as WorkOrder[];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["work-order-customers", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,full_name,phone")
        .eq("tenant_id", tenantId!)
        .order("full_name")
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });

  const {
    data: assignees = [],
    isError: assigneesError,
    error: assigneesLoadError,
  } = useQuery({
    queryKey: ["work-order-assignees", tenantId],
    enabled: Boolean(tenantId) && isAdmin,
    queryFn: () => listWorkOrderAssignees({ data: { tenantId: tenantId! } }),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!tenantId || !user) throw new Error("Your session is unavailable. Sign in again.");
      const scheduledAt = form.scheduledAt ? new Date(form.scheduledAt) : null;
      if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
        throw new Error("Enter a valid scheduled time.");
      }

      const { error } = await supabase.from("work_orders").insert({
        tenant_id: tenantId,
        title: form.title.trim(),
        description: form.description.trim(),
        customer_id: form.customerId || null,
        assigned_to: isAdmin ? form.assignedTo || null : user.id,
        scheduled_at: scheduledAt?.toISOString() ?? null,
        status: scheduledAt ? "scheduled" : "open",
        priority: form.priority,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Work order created");
      setDialogOpen(false);
      setForm({
        title: "",
        description: "",
        customerId: "",
        assignedTo: "",
        scheduledAt: "",
        priority: "normal",
      });
      await qc.invalidateQueries({ queryKey: ["tenant-work-orders", tenantId] });
    },
    onError: (createError: Error) => toast.error(createError.message),
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string;
      values: {
        status?: WorkOrderStatus;
        assigned_to?: string | null;
        resolution_notes?: string | null;
      };
    }) => {
      const { error } = await supabase.from("work_orders").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-work-orders", tenantId] }),
    onError: (updateError: Error) => toast.error(updateError.message),
  });

  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const assigneeById = new Map(assignees.map((assignee) => [assignee.id, assignee.name]));
  const activeCount = workOrders.filter(
    (workOrder) => !["completed", "cancelled"].includes(workOrder.status),
  ).length;
  const overdueCount = workOrders.filter(
    (workOrder) =>
      workOrder.scheduled_at &&
      new Date(workOrder.scheduled_at).getTime() < Date.now() &&
      !["completed", "cancelled"].includes(workOrder.status),
  ).length;
  const completedCount = workOrders.filter((workOrder) => workOrder.status === "completed").length;
  const shown = workOrders.filter((workOrder) => {
    if (statusFilter === "active") return !["completed", "cancelled"].includes(workOrder.status);
    if (statusFilter === "all") return true;
    return workOrder.status === statusFilter;
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Field work orders"
        description="Schedule customer visits, assign technicians, and track work through completion."
        action={
          canManage ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus aria-hidden="true" />
              New work order
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Active jobs" value={activeCount} hint="Open, scheduled or in progress" />
        <StatCard label="Past schedule" value={overdueCount} hint="Still needs an update" />
        <StatCard label="Completed" value={completedCount} hint="Recent work orders" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Filter work orders by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active work</SelectItem>
            <SelectItem value="all">All work orders</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        {isError && (
          <Button size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
            <RefreshCw className={isFetching ? "animate-spin" : ""} aria-hidden="true" />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        )}
      </div>

      {assigneesError && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          Could not load the technician list: {assigneesLoadError.message}
        </p>
      )}
      {isError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
        >
          Could not load work orders: {error.message}
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading work orders…</p>
      ) : !shown.length ? (
        <EmptyState
          title={statusFilter === "active" ? "No active work orders" : "No work orders found"}
          description={
            canManage
              ? "Create a work order to schedule a customer visit or field task."
              : "Work orders assigned to you will appear here."
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((workOrder) => {
            const customer = customerById.get(workOrder.customer_id ?? "");
            const isPastSchedule =
              workOrder.scheduled_at &&
              new Date(workOrder.scheduled_at).getTime() < Date.now() &&
              !["completed", "cancelled"].includes(workOrder.status);
            return (
              <article key={workOrder.id} className="space-y-3 rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words font-semibold">{workOrder.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {workOrder.description || "No job details provided."}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <Badge variant={workOrder.priority === "urgent" ? "destructive" : "outline"}>
                      {PRIORITY_LABEL[workOrder.priority]}
                    </Badge>
                    <Badge variant={workOrder.status === "completed" ? "default" : "secondary"}>
                      {STATUS_LABEL[workOrder.status]}
                    </Badge>
                  </div>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  {customer && (
                    <div className="flex min-w-0 items-center gap-2">
                      <UserRound
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="truncate">
                        {customer.full_name || "Customer"}
                        {customer.phone ? ` · ${customer.phone}` : ""}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {workOrder.scheduled_at
                        ? `${isPastSchedule ? "Past schedule · " : ""}${formatTenantDate(workOrder.scheduled_at)}`
                        : "Not scheduled"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Wifi className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {workOrder.assigned_to
                        ? (assigneeById.get(workOrder.assigned_to) ??
                          (workOrder.assigned_to === user?.id ? "You" : "Assigned technician"))
                        : "Unassigned"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Created {formatTenantDate(workOrder.created_at)}
                  </div>
                </div>
                {workOrder.resolution_notes && (
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Completion notes</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{workOrder.resolution_notes}</p>
                  </div>
                )}
                {canManage && (
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <Select
                      value={workOrder.status}
                      disabled={update.isPending}
                      onValueChange={(status) => {
                        if (status === "completed") {
                          setCompletionNotes(workOrder.resolution_notes ?? "");
                          setCompletionOrder(workOrder);
                          return;
                        }
                        update.mutate({
                          id: workOrder.id,
                          values: { status: status as WorkOrderStatus },
                        });
                      }}
                    >
                      <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Update job status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_LABEL).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isAdmin && (
                      <Select
                        value={workOrder.assigned_to ?? "unassigned"}
                        disabled={update.isPending || assigneesError}
                        onValueChange={(assignedTo) =>
                          update.mutate({
                            id: workOrder.id,
                            values: {
                              assigned_to: assignedTo === "unassigned" ? null : assignedTo,
                            },
                          })
                        }
                      >
                        <SelectTrigger
                          className="h-9 w-full sm:w-56"
                          aria-label="Assign technician"
                        >
                          <SelectValue placeholder="Assign technician" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {assignees.map((assignee) => (
                            <SelectItem key={assignee.id} value={assignee.id}>
                              {assignee.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New field work order</DialogTitle>
            <DialogDescription>
              Add the job details, customer, technician, and planned visit time.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="work-order-title">Job title</Label>
              <Input
                id="work-order-title"
                required
                maxLength={160}
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="e.g. Install customer router"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="work-order-description">Job details</Label>
              <Textarea
                id="work-order-description"
                rows={3}
                maxLength={4000}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Describe the issue or work to be completed."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="work-order-customer">Customer (optional)</Label>
                <Select
                  value={form.customerId || "none"}
                  onValueChange={(customerId) =>
                    setForm({ ...form, customerId: customerId === "none" ? "" : customerId })
                  }
                >
                  <SelectTrigger id="work-order-customer">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No linked customer</SelectItem>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.full_name || "Unnamed customer"}
                        {customer.phone ? ` · ${customer.phone}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="work-order-priority">Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(priority) => setForm({ ...form, priority: priority as Priority })}
                >
                  <SelectTrigger id="work-order-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {isAdmin && (
                <div className="space-y-2">
                  <Label htmlFor="work-order-assignee">Assign technician</Label>
                  <Select
                    value={form.assignedTo || "unassigned"}
                    onValueChange={(assignedTo) =>
                      setForm({
                        ...form,
                        assignedTo: assignedTo === "unassigned" ? "" : assignedTo,
                      })
                    }
                  >
                    <SelectTrigger id="work-order-assignee">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {assignees.map((assignee) => (
                        <SelectItem key={assignee.id} value={assignee.id}>
                          {assignee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="work-order-scheduled">Schedule visit (optional)</Label>
                <Input
                  id="work-order-scheduled"
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })}
                />
              </div>
            </div>
            {assigneesError && isAdmin && (
              <p role="alert" className="text-sm text-destructive">
                Could not load technicians: {assigneesLoadError.message}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !form.title.trim()}>
                {create.isPending ? "Creating…" : "Create work order"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(completionOrder)}
        onOpenChange={(open) => {
          if (!open) setCompletionOrder(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete work order</DialogTitle>
            <DialogDescription>
              Record the work completed for “{completionOrder?.title}”. You can leave the notes
              blank if there is nothing to add.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="work-order-resolution-notes">Completion notes</Label>
            <Textarea
              id="work-order-resolution-notes"
              rows={4}
              maxLength={4000}
              value={completionNotes}
              onChange={(event) => setCompletionNotes(event.target.value)}
              placeholder="Summarize the work, parts used, or any follow-up needed."
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCompletionOrder(null)}
              disabled={update.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={update.isPending || !completionOrder}
              onClick={() => {
                if (!completionOrder) return;
                update.mutate({
                  id: completionOrder.id,
                  values: {
                    status: "completed",
                    resolution_notes: completionNotes.trim() || null,
                  },
                });
                setCompletionOrder(null);
              }}
            >
              {update.isPending ? "Saving…" : "Complete work order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
