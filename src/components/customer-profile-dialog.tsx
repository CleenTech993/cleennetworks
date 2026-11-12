import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  ClipboardList,
  CircleDollarSign,
  Mail,
  MessageSquare,
  Phone,
  Router,
  Smartphone,
  Ticket,
  Wifi,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CustomerDocuments } from "@/components/customer-documents";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { formatTenantDate } from "@/lib/tenant-customization";

type CustomerProfile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  customer_type: string;
  status: string;
  pppoe_username: string | null;
  package_id: string | null;
  router_id: string | null;
  static_ip: string | null;
  expires_at: string | null;
  created_at: string;
  last_ip: string | null;
  last_seen_at: string | null;
  data_used_bytes: number;
  usage_bytes_in: number;
  usage_bytes_out: number;
};

type ActivityItem = {
  id: string;
  kind: "ticket" | "session" | "payment" | "work_order";
  title: string;
  detail: string;
  date: string;
  status: string;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

const activityIcon = {
  ticket: Ticket,
  session: Wifi,
  payment: CircleDollarSign,
  work_order: ClipboardList,
};

export function CustomerProfileDialog({
  customer,
  tenantId,
  packageName,
  routerName,
  canSeeEquipment,
  canSeeDocuments,
  onViewEquipment,
  onClose,
}: {
  customer: CustomerProfile;
  tenantId: string;
  packageName: string | null;
  routerName: string | null;
  canSeeEquipment: boolean;
  canSeeDocuments: boolean;
  onViewEquipment: () => void;
  onClose: () => void;
}) {
  const {
    data: activity = [],
    isPending,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["customer-profile-activity", tenantId, customer.id],
    queryFn: async (): Promise<ActivityItem[]> => {
      const [ticketsResult, sessionsResult, paymentsResult, workOrdersResult] = await Promise.all([
        supabase
          .from("support_tickets")
          .select("id,subject,status,created_at")
          .eq("tenant_id", tenantId)
          .eq("customer_id", customer.id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("sessions")
          .select("id,status,started_at,ended_at,ip_address")
          .eq("tenant_id", tenantId)
          .eq("customer_id", customer.id)
          .order("started_at", { ascending: false })
          .limit(10),
        supabase
          .from("payments")
          .select("id,amount,status,mpesa_receipt,created_at")
          .eq("tenant_id", tenantId)
          .eq("customer_id", customer.id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("work_orders")
          .select("id,title,status,created_at,scheduled_at")
          .eq("tenant_id", tenantId)
          .eq("customer_id", customer.id)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      if (ticketsResult.error)
        throw new Error(`Could not load customer tickets: ${ticketsResult.error.message}`);
      if (sessionsResult.error)
        throw new Error(`Could not load customer sessions: ${sessionsResult.error.message}`);
      if (paymentsResult.error)
        throw new Error(`Could not load customer payments: ${paymentsResult.error.message}`);
      if (workOrdersResult.error)
        throw new Error(`Could not load customer work orders: ${workOrdersResult.error.message}`);

      return [
        ...(ticketsResult.data ?? []).map((ticket) => ({
          id: `ticket-${ticket.id}`,
          kind: "ticket" as const,
          title: ticket.subject,
          detail: "Support ticket",
          date: ticket.created_at,
          status: ticket.status,
        })),
        ...(sessionsResult.data ?? []).map((session) => ({
          id: `session-${session.id}`,
          kind: "session" as const,
          title: session.status === "active" ? "Internet session started" : "Internet session",
          detail: [session.ip_address, session.ended_at ? "Ended" : "Currently active"]
            .filter(Boolean)
            .join(" | "),
          date: session.started_at,
          status: session.status,
        })),
        ...(paymentsResult.data ?? []).map((payment) => ({
          id: `payment-${payment.id}`,
          kind: "payment" as const,
          title: `Payment | KES ${Number(payment.amount).toLocaleString()}`,
          detail: payment.mpesa_receipt
            ? `M-Pesa receipt ${payment.mpesa_receipt}`
            : "Payment record",
          date: payment.created_at,
          status: payment.status,
        })),
        ...(workOrdersResult.data ?? []).map((workOrder) => ({
          id: `work-order-${workOrder.id}`,
          kind: "work_order" as const,
          title: `Work order | ${workOrder.title}`,
          detail: workOrder.scheduled_at
            ? `Scheduled ${formatTenantDate(workOrder.scheduled_at)}`
            : "Field service",
          date: workOrder.created_at,
          status: workOrder.status,
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    },
  });

  const usageBytes =
    Number(customer.data_used_bytes ?? 0) ||
    Number(customer.usage_bytes_in ?? 0) + Number(customer.usage_bytes_out ?? 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3 pr-7">
            <div className="min-w-0">
              <DialogTitle className="break-words text-xl">
                {customer.full_name || "Customer profile"}
              </DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{customer.customer_type}</Badge>
                <Badge variant={customer.status === "active" ? "default" : "secondary"}>
                  {customer.status}
                </Badge>
                {customer.pppoe_username && (
                  <span className="font-mono text-xs">{customer.pppoe_username}</span>
                )}
              </DialogDescription>
            </div>
            {canSeeEquipment && (
              <Button size="sm" variant="outline" onClick={onViewEquipment}>
                <Smartphone aria-hidden="true" />
                Equipment
              </Button>
            )}
          </div>
        </DialogHeader>

        <Tabs defaultValue="overview" className="mt-2">
          <TabsList className={`grid w-full ${canSeeDocuments ? "grid-cols-3" : "grid-cols-2"}`}>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Recent activity</TabsTrigger>
            {canSeeDocuments && <TabsTrigger value="documents">Documents</TabsTrigger>}
          </TabsList>
          <TabsContent value="overview" className="space-y-4">
            <section className="grid gap-3 sm:grid-cols-2">
              <ProfileField icon={Phone} label="Phone" value={customer.phone}>
                {customer.phone && (
                  <a
                    className="text-sm text-primary hover:underline"
                    href={`tel:${customer.phone}`}
                  >
                    Call customer
                  </a>
                )}
              </ProfileField>
              <ProfileField icon={Mail} label="Email" value={customer.email}>
                {customer.email && (
                  <a
                    className="text-sm text-primary hover:underline"
                    href={`mailto:${customer.email}`}
                  >
                    Send email
                  </a>
                )}
              </ProfileField>
              <ProfileField icon={Wifi} label="Package" value={packageName} />
              <ProfileField
                icon={CalendarDays}
                label="Service expiry"
                value={formatTenantDate(customer.expires_at, { dateOnly: true })}
              />
              <ProfileField icon={Router} label="Router" value={routerName} />
              <ProfileField
                icon={Activity}
                label="Last connection"
                value={
                  customer.last_seen_at
                    ? formatTenantDate(customer.last_seen_at)
                    : "No connection reported"
                }
              >
                {customer.last_ip && (
                  <span className="text-xs text-muted-foreground">IP {customer.last_ip}</span>
                )}
              </ProfileField>
              <ProfileField
                icon={Activity}
                label="Reported data usage"
                value={formatBytes(usageBytes)}
              />
              <ProfileField
                icon={CalendarDays}
                label="Customer since"
                value={formatTenantDate(customer.created_at, { dateOnly: true })}
              />
              {customer.static_ip && (
                <ProfileField icon={Router} label="Static IP" value={customer.static_ip} />
              )}
            </section>
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            {isPending ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Loading recent activity…
              </p>
            ) : isError ? (
              <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">
                <p className="text-destructive">{error.message}</p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  {isFetching ? "Retrying…" : "Try again"}
                </Button>
              </div>
            ) : activity.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <MessageSquare
                  className="mx-auto h-6 w-6 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="mt-2 text-sm font-medium">No recent activity</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Customer tickets, sessions, payments and field work will appear here.
                </p>
              </div>
            ) : (
              <ol className="divide-y rounded-lg border">
                {activity.map((item) => {
                  const Icon = activityIcon[item.kind];
                  return (
                    <li key={item.id} className="flex gap-3 p-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium">{item.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatTenantDate(item.date)}
                        </p>
                      </div>
                      <Badge variant={item.status === "success" ? "default" : "secondary"}>
                        {item.status}
                      </Badge>
                    </li>
                  );
                })}
              </ol>
            )}
          </TabsContent>
          {canSeeDocuments && (
            <TabsContent value="documents" className="mt-4">
              <CustomerDocuments tenantId={tenantId} customerId={customer.id} />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ProfileField({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: typeof Wifi;
  label: string;
  value: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border p-3">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-medium">{value || "Not provided"}</p>
      {children && <div className="mt-1 flex flex-col items-start gap-1">{children}</div>}
    </div>
  );
}
