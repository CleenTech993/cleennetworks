import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Pencil,
  CalendarPlus,
  PauseCircle,
  PlayCircle,
  Trash2,
  Search,
  Wifi,
  Activity,
  Smartphone,
  ShieldAlert,
  Radio,
  ExternalLink,
} from "lucide-react";
import { PageHeader, EmptyState, StatCard } from "@/components/dashboard-shell";
import { isRouterLive } from "@/lib/router-health";
import { isClientConnected, pppoeReportedRouterId } from "@/lib/pppoe-sessions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { randomCode } from "@/lib/codes";
import { expiryFrom } from "@/lib/duration";
import { formatSpeed, isExpired, renewedExpiry, validatePppoeCredentials } from "@/lib/pppoe";
import { logAudit } from "@/lib/audit";
import { useTenantLabels } from "@/hooks/use-tenant-customization";
import { formatTenantDate } from "@/lib/tenant-customization";

export const Route = createFileRoute("/tenant/pppoe")({
  head: () => ({
    meta: [
      { title: "PPPoE clients — Tenant console" },
      {
        name: "description",
        content:
          "Create PPPoE logins with a speed and duration, view live connected client devices, and manage subscriptions.",
      },
    ],
  }),
  component: PPPoE,
});

type Client = {
  id: string;
  full_name: string | null;
  phone: string | null;
  pppoe_username: string | null;
  pppoe_password: string | null;
  status: string;
  expires_at: string | null;
  package_id: string | null;
  router_id: string | null;
  // Reported by the router (read-only here)
  last_mac: string | null;
  last_ip: string | null;
  last_seen_at: string | null;
  last_router_id: string | null;
};
type Router = {
  id: string;
  name: string;
  status: string;
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
};
type Pkg = {
  id: string;
  name: string;
  active: boolean | null;
  duration_value: number | null;
  duration_unit: string | null;
  download_kbps: number | null;
  upload_kbps: number | null;
};

const empty = {
  full_name: "",
  phone: "",
  pppoe_username: "",
  pppoe_password: "",
  package_id: "",
  router_id: "",
  expires_at: "",
};

// <input type="datetime-local"> works in local time without a zone.
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function PPPoE() {
  const labels = useTenantLabels();
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [form, setForm] = useState(empty);
  const [showPw, setShowPw] = useState(false);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active_now" | "disconnected" | "suspended"
  >("all");

  const { data: clients, isLoading } = useQuery({
    queryKey: ["pppoe-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id,full_name,phone,pppoe_username,pppoe_password,status,expires_at,package_id,router_id,last_mac,last_ip,last_seen_at,last_router_id",
        )
        .eq("customer_type", "pppoe")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Client[];
    },
    refetchInterval: 5_000,
  });

  const { data: packages } = useQuery({
    queryKey: ["pppoe-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packages")
        .select("id,name,active,duration_value,duration_unit,download_kbps,upload_kbps")
        .eq("kind", "pppoe")
        .order("price");
      if (error) throw error;
      return data as Pkg[];
    },
  });

  const { data: portalTenant } = useQuery({
    queryKey: ["pppoe-portal-tenant", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("slug")
        .eq("id", tenantId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: routers } = useQuery({
    queryKey: ["pppoe-routers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routers")
        .select("id,name,status,last_heartbeat_at,last_seen_at")
        .order("name");
      if (error) throw error;
      return data as Router[];
    },
    refetchInterval: 5_000,
  });

  // Re-evaluate client connectivity every 3 seconds even without a new network payload
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 3_000);
    return () => clearInterval(i);
  }, []);

  // Supabase Realtime channel subscription for immediate updates on client connect/disconnect
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`pppoe-customers-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "customers",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["pppoe-customers"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [tenantId, qc]);

  const routerById = useMemo(() => new Map((routers ?? []).map((r) => [r.id, r])), [routers]);
  const pkgById = useMemo(() => new Map((packages ?? []).map((p) => [p.id, p])), [packages]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["pppoe-customers"] });
  const unassigned = (clients ?? []).filter((c) => !c.router_id).length;

  // Active connected devices count
  const activeNowCount = useMemo(() => {
    if (!clients) return 0;
    return clients.filter((c) => {
      const reportedRouterId = pppoeReportedRouterId(c);
      const router = reportedRouterId ? routerById.get(reportedRouterId) : undefined;
      return isClientConnected(c.last_seen_at) && !!router && isRouterLive(router);
    }).length;
  }, [clients, routerById]);

  // Filtered clients list
  const filteredClients = useMemo(() => {
    if (!clients) return [];
    return clients.filter((c) => {
      const reportedRouterId = pppoeReportedRouterId(c);
      const router = reportedRouterId ? routerById.get(reportedRouterId) : undefined;
      const isConnected = isClientConnected(c.last_seen_at) && !!router && isRouterLive(router);

      if (statusFilter === "active_now" && !isConnected) return false;
      if (statusFilter === "disconnected" && isConnected) return false;
      if (statusFilter === "suspended" && c.status !== "suspended") return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return (
        (c.pppoe_username ?? "").toLowerCase().includes(q) ||
        (c.full_name ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.last_mac ?? "").toLowerCase().includes(q) ||
        (c.last_ip ?? "").toLowerCase().includes(q)
      );
    });
  }, [clients, routerById, statusFilter, search]);

  const openNew = () => {
    setForm({
      ...empty,
      pppoe_password: randomCode(8),
      router_id: routers?.length === 1 ? routers[0].id : "",
    });
    setEditing("new");
  };

  const openEdit = (c: Client) => {
    setForm({
      full_name: c.full_name ?? "",
      phone: c.phone ?? "",
      pppoe_username: c.pppoe_username ?? "",
      pppoe_password: c.pppoe_password ?? "",
      package_id: c.package_id ?? "",
      router_id: c.router_id ?? "",
      expires_at: toLocalInput(c.expires_at),
    });
    setEditing(c);
  };

  const pickPackage = (id: string) => {
    const pkg = pkgById.get(id);
    const next = { ...form, package_id: id };
    if (editing === "new" && pkg?.duration_value && pkg.duration_unit) {
      next.expires_at = toLocalInput(expiryFrom(pkg.duration_value, pkg.duration_unit));
    }
    setForm(next);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const err = validatePppoeCredentials(form.pppoe_username.trim(), form.pppoe_password.trim());
      if (err) throw new Error(err);
      if (!form.router_id) throw new Error("Choose the router this client connects through.");
      const row = {
        full_name: form.full_name.trim() || null,
        phone: form.phone.trim() || null,
        pppoe_username: form.pppoe_username.trim(),
        pppoe_password: form.pppoe_password.trim(),
        package_id: form.package_id || null,
        router_id: form.router_id,
        expires_at: fromLocalInput(form.expires_at),
      };
      const { data, error } =
        editing === "new"
          ? await supabase
              .from("customers")
              .insert({ ...row, tenant_id: tenantId, customer_type: "pppoe", status: "active" })
              .select("id")
              .single()
          : await supabase
              .from("customers")
              .update(row)
              .eq("id", (editing as Client).id)
              .select("id")
              .single();

      if (error)
        throw error.code === "23505"
          ? new Error("That username is already used by another client.")
          : error;

      await logAudit({
        action: editing === "new" ? "create" : "update",
        resource: "pppoe_client",
        resourceId: data?.id ?? (editing !== "new" ? (editing as Client).id : undefined),
        details: {
          username: row.pppoe_username,
          full_name: row.full_name,
          router_id: row.router_id,
          package_id: row.package_id,
        },
        tenantId,
      });
    },
    onSuccess: () => {
      toast.success("Saved — the router picks it up within seconds");
      refresh();
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renew = useMutation({
    mutationFn: async (c: Client) => {
      const pkg = c.package_id ? pkgById.get(c.package_id) : undefined;
      if (!pkg?.duration_value || !pkg.duration_unit)
        throw new Error("Assign a package with a duration first.");
      const newExpiry = renewedExpiry(c.expires_at, pkg.duration_value, pkg.duration_unit);
      const { error } = await supabase
        .from("customers")
        .update({
          expires_at: newExpiry,
          status: "active",
        })
        .eq("id", c.id);
      if (error) throw error;

      await logAudit({
        action: "renew",
        resource: "pppoe_client",
        resourceId: c.id,
        details: { username: c.pppoe_username, new_expires_at: newExpiry },
        tenantId,
      });
    },
    onSuccess: () => {
      toast.success("Client subscription renewed");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ c, status }: { c: Client; status: "active" | "suspended" }) => {
      const { error } = await supabase.from("customers").update({ status }).eq("id", c.id);
      if (error) throw error;

      await logAudit({
        action: status === "active" ? "resume" : "suspend",
        resource: "pppoe_client",
        resourceId: c.id,
        details: { username: c.pppoe_username, status },
        tenantId,
      });
    },
    onSuccess: (_d, v) => {
      toast.success(v.status === "active" ? "Client re-activated" : "Client suspended");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (c: Client) => {
      const { error } = await supabase.from("customers").delete().eq("id", c.id);
      if (error) throw error;

      await logAudit({
        action: "delete",
        resource: "pppoe_client",
        resourceId: c.id,
        details: { username: c.pppoe_username },
        tenantId,
      });
    },
    onSuccess: () => {
      toast.success("Client deleted");
      refresh();
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activePackages = (packages ?? []).filter(
    (p) => p.active !== false || p.id === form.package_id,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${labels.pppoe} Clients & Devices`}
        description="Manage PPPoE client logins, monitor real-time connected devices, speeds, and router assignments."
        action={
          <div className="flex gap-2">
            {portalTenant?.slug && (
              <Button variant="outline" size="sm" asChild>
                <a href={`/pppoe/${portalTenant.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" /> Customer portal
                </a>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setShowPw((v) => !v)}>
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{" "}
              {showPw ? "Hide" : "Show"} passwords
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" /> Add client
            </Button>
          </div>
        }
      />

      {/* Overview Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total PPPoE Clients"
          value={clients?.length ?? 0}
          hint="Registered logins"
          icon={Smartphone}
        />
        <div className="rounded-xl border bg-card p-5 relative overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-muted-foreground">Active Now (Online)</p>
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {activeNowCount}
            </span>
            <span className="text-xs text-muted-foreground">
              of {clients?.length ?? 0} connected
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Reporting live via MikroTik router sessions
          </p>
        </div>
        <StatCard
          label="Disconnected / Idle"
          value={(clients?.length ?? 0) - activeNowCount}
          hint="Not currently transmitting"
          icon={Radio}
        />
        <StatCard
          label="Router Assignments"
          value={unassigned === 0 ? "100% Bound" : `${unassigned} Unassigned`}
          hint={unassigned === 0 ? "All clients bound to router" : "Requires router assignment"}
          icon={Wifi}
        />
      </div>

      {unassigned > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
          <span>
            {unassigned} {unassigned === 1 ? "client is" : "clients are"} not assigned to a router,
            so {unassigned === 1 ? "its login works" : "their logins work"} on every router. Edit
            each one and choose the router it connects through.
          </span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <Button
            size="sm"
            variant={statusFilter === "all" ? "default" : "outline"}
            onClick={() => setStatusFilter("all")}
            className="text-xs"
          >
            All Clients ({clients?.length ?? 0})
          </Button>
          <Button
            size="sm"
            variant={statusFilter === "active_now" ? "default" : "outline"}
            onClick={() => setStatusFilter("active_now")}
            className="text-xs gap-1.5"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Active Devices ({activeNowCount})
          </Button>
          <Button
            size="sm"
            variant={statusFilter === "disconnected" ? "default" : "outline"}
            onClick={() => setStatusFilter("disconnected")}
            className="text-xs"
          >
            Disconnected ({(clients?.length ?? 0) - activeNowCount})
          </Button>
          <Button
            size="sm"
            variant={statusFilter === "suspended" ? "default" : "outline"}
            onClick={() => setStatusFilter("suspended")}
            className="text-xs"
          >
            Suspended ({(clients ?? []).filter((c) => c.status === "suspended").length})
          </Button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, user, IP, MAC…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Loading PPPoE clients…
        </div>
      ) : !clients?.length ? (
        <EmptyState
          title="No PPPoE clients"
          description="Add a client to create their PPPoE login. Create a PPPoE package first (Packages page) to set the speed and duration."
        />
      ) : filteredClients.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          No clients match your filter or search query.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">PPPoE Login</th>
                <th className="px-4 py-3">Router</th>
                <th className="px-4 py-3">Device & Connection</th>
                <th className="px-4 py-3">Package / Speed</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredClients.map((c) => {
                const pkg = c.package_id ? pkgById.get(c.package_id) : undefined;
                const expired = isExpired(c.expires_at);
                const label = c.status !== "active" ? c.status : expired ? "expired" : "active";
                const reportedRouterId = pppoeReportedRouterId(c);
                const router = reportedRouterId ? routerById.get(reportedRouterId) : undefined;
                const routerLive = router ? isRouterLive(router) : false;
                const connected = isClientConnected(c.last_seen_at) && !!router && routerLive;

                return (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors align-top">
                    <td className="px-4 py-3 font-medium">
                      <div className="text-foreground">{c.full_name ?? "—"}</div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {c.phone ?? "No phone"}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <div className="font-semibold text-foreground">{c.pppoe_username ?? "—"}</div>
                      <div className="text-muted-foreground">
                        {showPw ? c.pppoe_password : "••••••••"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {router ? (
                        <div>
                          <div className="flex items-center gap-1.5 font-medium">
                            <span
                              className={`h-2 w-2 rounded-full ${routerLive ? "bg-emerald-500" : "bg-red-500"}`}
                              aria-hidden
                            />
                            {router.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {routerLive ? "Router Online" : "Router Offline"}
                            {c.last_router_id ? " · Reported here" : " · Assigned"}
                          </div>
                        </div>
                      ) : reportedRouterId ? (
                        <span className="text-xs text-muted-foreground">Router removed</span>
                      ) : (
                        <div>
                          <Badge
                            variant="outline"
                            className="border-amber-500 text-amber-600 text-[10px]"
                          >
                            Not bound
                          </Badge>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            No reporting router yet
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {connected ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            Active / Connected
                          </span>
                          {c.last_ip && (
                            <div className="font-mono text-xs font-medium text-foreground bg-muted/70 px-1.5 py-0.5 rounded border inline-block">
                              IP: {c.last_ip}
                            </div>
                          )}
                          {c.last_mac && (
                            <div className="font-mono text-[11px] text-muted-foreground">
                              MAC: {c.last_mac}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground border">
                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                            Disconnected
                          </span>
                          {c.last_ip && (
                            <div className="font-mono text-xs text-muted-foreground">
                              Last IP: {c.last_ip}
                            </div>
                          )}
                          {c.last_mac ? (
                            <div className="font-mono text-[11px] text-muted-foreground">
                              MAC: {c.last_mac}
                            </div>
                          ) : (
                            <div className="text-[11px] text-muted-foreground">No MAC detected</div>
                          )}
                          {c.last_seen_at && (
                            <div className="text-[10px] text-muted-foreground/80">
                              Seen {formatTenantDate(c.last_seen_at)}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pkg ? (
                        <div>
                          <div className="font-medium">{pkg.name}</div>
                          <div className="text-xs text-muted-foreground">
                            ↓ {formatSpeed(pkg.download_kbps)} · ↑ {formatSpeed(pkg.upload_kbps)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No package (unlimited)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {c.expires_at ? formatTenantDate(c.expires_at) : "Never expires"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          label === "active"
                            ? "default"
                            : label === "expired"
                              ? "destructive"
                              : "secondary"
                        }
                        className="capitalize text-[11px]"
                      >
                        {label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Renew by package duration"
                          onClick={() => renew.mutate(c)}
                        >
                          <CalendarPlus className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Edit"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {c.status === "active" ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Suspend"
                            onClick={() => setStatus.mutate({ c, status: "suspended" })}
                          >
                            <PauseCircle className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Re-activate"
                            onClick={() => setStatus.mutate({ c, status: "active" })}
                          >
                            <PlayCircle className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Delete"
                          onClick={() => setDeleting(c)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit / New Dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "New PPPoE client" : "Edit PPPoE client"}
            </DialogTitle>
            <DialogDescription>
              The client enters this username and password in their router's PPPoE WAN settings.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Full name</Label>
                <Input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="2547XXXXXXXX"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>PPPoE username</Label>
                <Input
                  value={form.pppoe_username}
                  onChange={(e) => setForm({ ...form, pppoe_username: e.target.value })}
                  placeholder="e.g. john.house12"
                />
              </div>
              <div>
                <Label>PPPoE password</Label>
                <div className="flex gap-2">
                  <Input
                    className="font-mono"
                    value={form.pppoe_password}
                    onChange={(e) => setForm({ ...form, pppoe_password: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Generate"
                    onClick={() => setForm({ ...form, pppoe_password: randomCode(8) })}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
            <div>
              <Label>Package (sets speed and duration)</Label>
              <Select value={form.package_id} onValueChange={pickPackage}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      activePackages.length
                        ? "Select package"
                        : "No PPPoE packages yet — create one first"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {activePackages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · ↓{formatSpeed(p.download_kbps)} ↑{formatSpeed(p.upload_kbps)} ·{" "}
                      {p.duration_value} {p.duration_unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Expires (blank = never)</Label>
                <Input
                  type="datetime-local"
                  value={form.expires_at}
                  onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                />
              </div>
              <div>
                <Label>Router</Label>
                <Select
                  value={form.router_id}
                  onValueChange={(v) => setForm({ ...form, router_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a router" />
                  </SelectTrigger>
                  <SelectContent>
                    {routers?.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} · {isRouterLive(r) ? "online" : "offline"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  A login works on this router only.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending || !form.pppoe_username || !form.pppoe_password || !form.router_id
              }
            >
              {editing === "new" ? "Create client" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleting?.full_name ?? deleting?.pppoe_username}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their login is removed from the router and any live connection is dropped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
