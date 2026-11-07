import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, CalendarClock, Megaphone, Power, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createCustomerAnnouncement,
  createMaintenanceWindow,
  deactivateCommunication,
  getCommunicationsAdminData,
} from "@/lib/communications.functions";

function isoDate(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now())
    throw new Error("Choose an end time in the future.");
  return date.toISOString();
}

function formatDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Until manually ended";
}

function communicationStatus(
  active: boolean,
  startsAt: string,
  endsAt: string | null,
  now: number,
): string {
  if (!active || (endsAt !== null && Date.parse(endsAt) <= now)) return "Ended";
  if (Date.parse(startsAt) > now) return "Scheduled";
  return "Active";
}

const maintenanceModes = [
  { value: "notice", label: "Notice only", description: "Display a notice; access continues." },
  {
    value: "block_new",
    label: "Pause new connections",
    description: "Pause new purchases and voucher/reconnect flows at the selected site.",
  },
  {
    value: "block_all",
    label: "Pause all connections",
    description: "Pause new access and disconnect managed sessions on router sync.",
  },
] as const;

export function CommunicationsManager({ platform }: { platform: boolean }) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [tenantId, setTenantId] = useState("");
  const [customerTarget, setCustomerTarget] = useState("");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [announcementEndsAt, setAnnouncementEndsAt] = useState("");
  const [maintenanceTitle, setMaintenanceTitle] = useState("");
  const [maintenanceBody, setMaintenanceBody] = useState("");
  const [routerId, setRouterId] = useState("");
  const [maintenanceMode, setMaintenanceMode] =
    useState<(typeof maintenanceModes)[number]["value"]>("notice");
  const [maintenanceEndsAt, setMaintenanceEndsAt] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["communications-admin", platform, tenantId],
    queryFn: () =>
      getCommunicationsAdminData({
        data: { platform, tenantId: platform ? tenantId || null : null },
      }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["communications-admin"] });
  const sendAnnouncement = useMutation({
    mutationFn: async () => {
      if (customerTarget && !tenantId && platform)
        throw new Error("Choose a tenant before selecting a customer.");
      return createCustomerAnnouncement({
        data: {
          platform,
          tenantId: platform ? tenantId || null : null,
          customerId: customerTarget || null,
          title: announcementTitle,
          body: announcementBody,
          endsAt: isoDate(announcementEndsAt),
        },
      });
    },
    onSuccess: () => {
      toast.success("Message published");
      setAnnouncementTitle("");
      setAnnouncementBody("");
      setAnnouncementEndsAt("");
      setCustomerTarget("");
      void refresh();
    },
    onError: (cause: Error) => toast.error(cause.message),
  });

  const startMaintenance = useMutation({
    mutationFn: () =>
      createMaintenanceWindow({
        data: {
          platform,
          routerId: platform ? null : routerId || null,
          title: maintenanceTitle,
          body: maintenanceBody,
          mode: maintenanceMode,
          endsAt: isoDate(maintenanceEndsAt),
        },
      }),
    onSuccess: () => {
      toast.success("Maintenance notice is active");
      setMaintenanceTitle("");
      setMaintenanceBody("");
      setMaintenanceEndsAt("");
      void refresh();
    },
    onError: (cause: Error) => toast.error(cause.message),
  });

  const endCommunication = useMutation({
    mutationFn: (input: { id: string; kind: "announcement" | "maintenance" }) =>
      deactivateCommunication({ data: { platform, ...input } }),
    onSuccess: () => {
      toast.success("Communication ended");
      void refresh();
    },
    onError: (cause: Error) => toast.error(cause.message),
  });

  return (
    <div className="space-y-6">
      {platform && (
        <div className="max-w-sm space-y-2">
          <Label htmlFor="communications-tenant">Message audience</Label>
          <select
            id="communications-tenant"
            value={tenantId}
            onChange={(event) => {
              setTenantId(event.target.value);
              setCustomerTarget("");
            }}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All tenants (platform-wide)</option>
            {(data?.tenants ?? []).map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading communication settings…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load communications."}
        </p>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="space-y-4 rounded-xl border bg-card p-5">
              <div className="flex items-start gap-3">
                <Megaphone className="mt-1 h-5 w-5 text-primary" />
                <div>
                  <h2 className="font-semibold">Customer message</h2>
                  <p className="text-sm text-muted-foreground">
                    All-customer messages appear in the customer inbox and captive portal.
                    Individual messages appear in that customer’s inbox.
                  </p>
                </div>
              </div>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendAnnouncement.mutate();
                }}
              >
                {data?.tenantId && (
                  <div className="space-y-2">
                    <Label htmlFor="message-customer">Recipient</Label>
                    <select
                      id="message-customer"
                      value={customerTarget}
                      onChange={(event) => setCustomerTarget(event.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">
                        All customers in {platform ? "selected tenant" : "your ISP"}
                      </option>
                      {(data?.customers ?? []).map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.full_name || customer.phone || "Customer"}
                          {customer.phone ? ` · ${customer.phone}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="announcement-title">Subject</Label>
                  <Input
                    id="announcement-title"
                    maxLength={120}
                    required
                    value={announcementTitle}
                    onChange={(event) => setAnnouncementTitle(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="announcement-body">Message</Label>
                  <Textarea
                    id="announcement-body"
                    maxLength={2000}
                    required
                    rows={4}
                    value={announcementBody}
                    onChange={(event) => setAnnouncementBody(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="announcement-end">Hide after (optional)</Label>
                  <Input
                    id="announcement-end"
                    type="datetime-local"
                    value={announcementEndsAt}
                    onChange={(event) => setAnnouncementEndsAt(event.target.value)}
                  />
                </div>
                <Button type="submit" disabled={sendAnnouncement.isPending}>
                  <Bell className="h-4 w-4" />
                  {sendAnnouncement.isPending ? "Publishing…" : "Publish message"}
                </Button>
              </form>
            </section>

            <section className="space-y-4 rounded-xl border bg-card p-5">
              <div className="flex items-start gap-3">
                <CalendarClock className="mt-1 h-5 w-5 text-primary" />
                <div>
                  <h2 className="font-semibold">Maintenance mode</h2>
                  <p className="text-sm text-muted-foreground">
                    {platform
                      ? "Platform maintenance is shown on every captive portal."
                      : "Choose one site or your whole ISP. Notices appear on the captive portal."}
                  </p>
                </div>
              </div>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  startMaintenance.mutate();
                }}
              >
                {!platform && (
                  <div className="space-y-2">
                    <Label htmlFor="maintenance-site">Site</Label>
                    <select
                      id="maintenance-site"
                      value={routerId}
                      onChange={(event) => setRouterId(event.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">All sites</option>
                      {(data?.routers ?? []).map((router) => (
                        <option key={router.id} value={router.id}>
                          {router.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="maintenance-mode">Effect</Label>
                  <select
                    id="maintenance-mode"
                    value={maintenanceMode}
                    onChange={(event) =>
                      setMaintenanceMode(
                        event.target.value as (typeof maintenanceModes)[number]["value"],
                      )
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {maintenanceModes.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {maintenanceModes.find((mode) => mode.value === maintenanceMode)?.description}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maintenance-title">Title</Label>
                  <Input
                    id="maintenance-title"
                    maxLength={120}
                    required
                    value={maintenanceTitle}
                    onChange={(event) => setMaintenanceTitle(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maintenance-body">Customer notice</Label>
                  <Textarea
                    id="maintenance-body"
                    maxLength={2000}
                    required
                    rows={3}
                    value={maintenanceBody}
                    onChange={(event) => setMaintenanceBody(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maintenance-end">End at (optional)</Label>
                  <Input
                    id="maintenance-end"
                    type="datetime-local"
                    value={maintenanceEndsAt}
                    onChange={(event) => setMaintenanceEndsAt(event.target.value)}
                  />
                </div>
                <Button type="submit" disabled={startMaintenance.isPending}>
                  <Radio className="h-4 w-4" />
                  {startMaintenance.isPending ? "Starting…" : "Start maintenance"}
                </Button>
              </form>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Recent customer messages</h2>
              {!data?.announcements.length ? (
                <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                  No messages have been published in this scope.
                </p>
              ) : (
                data.announcements.map((message) => {
                  const status = communicationStatus(
                    message.active,
                    message.starts_at,
                    message.ends_at,
                    now,
                  );
                  return (
                    <article key={message.id} className="rounded-xl border bg-card p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-medium">{message.title}</h3>
                        <Badge variant={status === "Active" ? "default" : "secondary"}>
                          {status}
                        </Badge>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        {message.body}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {message.customerLabel ?? "All customers"} · Ends{" "}
                        {formatDate(message.ends_at)}
                      </p>
                      {message.active && status !== "Ended" && (
                        <Button
                          className="mt-3"
                          size="sm"
                          variant="outline"
                          disabled={endCommunication.isPending}
                          onClick={() =>
                            endCommunication.mutate({ id: message.id, kind: "announcement" })
                          }
                        >
                          <Power className="h-3.5 w-3.5" /> End message
                        </Button>
                      )}
                    </article>
                  );
                })
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Maintenance history</h2>
              {!data?.maintenance.length ? (
                <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                  No maintenance notices have been created in this scope.
                </p>
              ) : (
                data.maintenance.map((maintenance) => {
                  const status = communicationStatus(
                    maintenance.active,
                    maintenance.starts_at,
                    maintenance.ends_at,
                    now,
                  );
                  return (
                    <article key={maintenance.id} className="rounded-xl border bg-card p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-medium">{maintenance.title}</h3>
                        <Badge variant={status === "Active" ? "default" : "secondary"}>
                          {status}
                        </Badge>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        {maintenance.body}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {maintenance.routerLabel ??
                          (maintenance.tenant_id ? "All sites" : "Platform")}{" "}
                        · {maintenanceModes.find((mode) => mode.value === maintenance.mode)?.label}{" "}
                        · Ends {formatDate(maintenance.ends_at)}
                      </p>
                      {maintenance.active && status !== "Ended" && (
                        <Button
                          className="mt-3"
                          size="sm"
                          variant="outline"
                          disabled={endCommunication.isPending}
                          onClick={() =>
                            endCommunication.mutate({ id: maintenance.id, kind: "maintenance" })
                          }
                        >
                          <Power className="h-3.5 w-3.5" /> End maintenance
                        </Button>
                      )}
                    </article>
                  );
                })
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
