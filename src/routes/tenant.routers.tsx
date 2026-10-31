import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Copy,
  Router as RouterIcon,
  Trash2,
  Globe,
  Wifi,
  Cpu,
  HardDrive,
  Thermometer,
  Activity,
  Check,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fmtUptime, healthScore, healthTone, isRouterLive } from "@/lib/router-health";
import { logAudit } from "@/lib/audit";

export const Route = createFileRoute("/tenant/routers")({ component: RoutersPage });

function RoutersPage() {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const { data: routers, isLoading } = useQuery({
    queryKey: ["routers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    refetchInterval: 2_000,
  });

  // Live updates: the heartbeat endpoint updates the router row every 2s, so refetch the moment it
  // changes instead of waiting for the next poll.
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`routers-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "routers", filter: `tenant_id=eq.${tenantId}` },
        () => void qc.invalidateQueries({ queryKey: ["routers"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [tenantId, qc]);

  // "Online" is time-based (last check-in within 3 min), so re-evaluate it as time passes even when no new data arrives.
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 2_000);
    return () => clearInterval(i);
  }, []);

  const addRouter = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const { data, error } = await supabase
        .from("routers")
        .insert({
          tenant_id: tenantId,
          name,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("Router added — copy the provisioning command below");
      qc.invalidateQueries({ queryKey: ["routers"] });
      setOpen(false);
      setName("");
      void logAudit({
        action: "create",
        resource: "router",
        resourceId: data?.id,
        details: { name },
        tenantId,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [showCmd, setShowCmd] = useState<Record<string, boolean>>({});
  const delRouter = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("routers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, id) => {
      toast.success("Router deleted");
      qc.invalidateQueries({ queryKey: ["routers"] });
      void logAudit({
        action: "delete",
        resource: "router",
        resourceId: id,
        tenantId,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rotate = useMutation({
    mutationFn: async ({ id, revoke }: { id: string; revoke: boolean }) => {
      const { error } = await supabase.rpc("rotate_router_token", {
        p_router_id: id,
        p_revoke_device: revoke,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(
        v.revoke
          ? "Access revoked. Run the new command on the router to reconnect it."
          : "New command ready",
      );
      setShowCmd((s) => ({ ...s, [v.id]: true }));
      qc.invalidateQueries({ queryKey: ["routers"] });
      void logAudit({
        action: "rotate_token",
        resource: "router",
        resourceId: v.id,
        details: { revoke: v.revoke },
        tenantId,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function provisionCommand(token: string) {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `/tool fetch url="${base}/api/public/provision/${token}/router.rsc" mode=https dst-path=auto-config.rsc; :delay 1s; :execute {/import file-name=auto-config.rsc}`;
  }

  return (
    <div>
      <PageHeader
        title="Routers"
        description="MikroTik devices, real-time connectivity and IP status."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" /> Add router
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New router</DialogTitle>
                <DialogDescription>
                  Give it a label. You'll get a one-line MikroTik provisioning command.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <Label htmlFor="rname">Name</Label>
                <Input
                  id="rname"
                  placeholder="Site A — Tower 1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button onClick={() => addRouter.mutate()} disabled={!name || addRouter.isPending}>
                  {addRouter.isPending ? "Creating…" : "Create router"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading routers…</p>
      ) : !routers?.length ? (
        <EmptyState
          title="No routers yet"
          description="Add a MikroTik device. We'll generate a zero-touch provisioning command you paste into the router terminal."
        />
      ) : (
        <div className="space-y-3">
          {routers.map((r) => {
            const live = isRouterLive(r);
            const score = healthScore(r);
            const tone = healthTone(score);
            const primaryIp = r.wan_ip ?? r.public_ip ?? null;
            const ramPct =
              r.total_memory_mb && r.free_memory_mb != null
                ? Math.round(((r.total_memory_mb - r.free_memory_mb) / r.total_memory_mb) * 100)
                : (r.ram_usage ?? null);

            return (
              <div
                key={r.id}
                className="group rounded-xl border bg-card p-4 transition-all hover:border-border/80 hover:shadow-xs"
              >
                {/* Header row: Status, Identity & Quick Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/40">
                  <div className="flex items-center gap-3">
                    <div
                      className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${
                        live
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                          : "bg-muted text-muted-foreground border-border/50"
                      }`}
                    >
                      <RouterIcon className="h-5 w-5" />
                      <span
                        className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${
                          live ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"
                        }`}
                      />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to="/tenant/routers/$id"
                          params={{ id: r.id }}
                          className="font-semibold text-base hover:text-primary transition-colors flex items-center gap-1.5"
                        >
                          {r.name}
                        </Link>
                        <Badge
                          variant={live ? "default" : "secondary"}
                          className={
                            live
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                              : ""
                          }
                        >
                          {r.status === "pending" ? "pending setup" : live ? "online" : "offline"}
                        </Badge>
                        {live && (
                          <Badge
                            variant={
                              tone === "good"
                                ? "success"
                                : tone === "warn"
                                  ? "warning"
                                  : "destructive"
                            }
                          >
                            Health {score}%
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {r.board_name ?? r.model ?? "MikroTik Router"}
                        {r.routeros_version && <span> · RouterOS v{r.routeros_version}</span>}
                        {r.architecture && <span> · {r.architecture}</span>}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                      <Link to="/tenant/routers/$id" params={{ id: r.id }}>
                        <Activity className="h-3.5 w-3.5 text-primary" /> View Details
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() => setShowCmd((s) => ({ ...s, [r.id]: !s[r.id] }))}
                    >
                      Setup
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      aria-label="Delete router"
                      onClick={() => {
                        if (confirm(`Delete router "${r.name}"? Its history will be removed.`))
                          delRouter.mutate(r.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Professional Network & IP Address Ribbon */}
                <div className="my-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                  {/* WAN IP Card */}
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 border border-border/60 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Globe className="h-4 w-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                          WAN IP
                        </p>
                        <p className="font-mono font-medium text-foreground truncate">
                          {primaryIp ?? "Pending IP"}
                        </p>
                      </div>
                    </div>
                    {primaryIp && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(primaryIp);
                          toast.success("WAN IP copied");
                        }}
                        className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors"
                        title="Copy WAN IP"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {/* LAN Gateway IP Card */}
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 border border-border/60 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Wifi className="h-4 w-4 text-emerald-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                          LAN Gateway
                        </p>
                        <p className="font-mono font-medium text-foreground truncate">
                          {r.lan_ip ?? "10.5.50.1"}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(r.lan_ip ?? "10.5.50.1");
                        toast.success("LAN Gateway IP copied");
                      }}
                      className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors"
                      title="Copy LAN IP"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>

                  {/* CPU Load Metric */}
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border/60 px-3 py-2">
                    <Cpu className="h-4 w-4 text-amber-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                          CPU Load
                        </p>
                        <span className="font-medium font-mono text-[11px]">
                          {r.cpu_load ?? r.cpu_usage ?? "—"}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted mt-1 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            (r.cpu_load ?? r.cpu_usage ?? 0) > 80
                              ? "bg-rose-500"
                              : (r.cpu_load ?? r.cpu_usage ?? 0) > 50
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(100, r.cpu_load ?? r.cpu_usage ?? 0)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* RAM Usage Metric */}
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border/60 px-3 py-2">
                    <HardDrive className="h-4 w-4 text-sky-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                          RAM Usage
                        </p>
                        <span className="font-medium font-mono text-[11px]">
                          {ramPct != null ? `${ramPct}%` : "—"}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted mt-1 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            (ramPct ?? 0) > 85
                              ? "bg-rose-500"
                              : (ramPct ?? 0) > 70
                                ? "bg-amber-500"
                                : "bg-sky-500"
                          }`}
                          style={{ width: `${Math.min(100, ramPct ?? 0)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom telemetry strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] text-muted-foreground border-t border-border/30">
                  <div className="flex items-center gap-3">
                    <span>
                      Uptime: <strong className="text-foreground font-mono">{fmtUptime(r.uptime_seconds)}</strong>
                    </span>
                    {r.temperature != null && (
                      <span className="flex items-center gap-1">
                        <Thermometer className="h-3 w-3 text-rose-500" />
                        {r.temperature}°C
                      </span>
                    )}
                    {r.mac_address && (
                      <span className="hidden md:inline font-mono">
                        MAC: {r.mac_address}
                      </span>
                    )}
                  </div>
                  <div>
                    Last heartbeat:{" "}
                    <span className="text-foreground font-medium">
                      {(r.last_heartbeat_at ?? r.last_seen_at)
                        ? `${Math.max(
                            0,
                            Math.round(
                              (Date.now() -
                                new Date((r.last_heartbeat_at ?? r.last_seen_at)!).getTime()) /
                                1000,
                            ),
                          )}s ago`
                        : "never"}
                    </span>
                  </div>
                </div>

                {/* Provisioning command drawer */}
                {r.provision_token &&
                  (r.status === "pending" || showCmd[r.id]) &&
                  (() => {
                    const expired =
                      !!r.provision_token_expires_at &&
                      new Date(r.provision_token_expires_at).getTime() <= Date.now();
                    return (
                      <div className="mt-3 rounded-md bg-muted p-3 font-mono text-xs">
                        {expired ? (
                          <p className="font-sans text-xs text-muted-foreground">
                            This provisioning command has expired. Generate a new one to set the
                            router up again.
                          </p>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <code className="break-all">{provisionCommand(r.provision_token)}</code>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                navigator.clipboard.writeText(provisionCommand(r.provision_token!));
                                toast.success("Copied");
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                        <p className="mt-2 font-sans text-[10px] text-muted-foreground">
                          {expired
                            ? "Commands are valid for 24 hours. A router that is already set up keeps working."
                            : `Paste this into the MikroTik terminal. The router will auto-configure and report back. Valid until ${r.provision_token_expires_at ? new Date(r.provision_token_expires_at).toLocaleString() : "revoked"}.`}
                        </p>
                        {r.legacy_token_auth && (
                          <p className="mt-1 font-sans text-[10px] text-amber-600">
                            This router still uses an old-style key. Run a new command on it to
                            upgrade.
                          </p>
                        )}
                        <div className="mt-2 flex gap-2 font-sans">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rotate.isPending}
                            onClick={() => rotate.mutate({ id: r.id, revoke: false })}
                          >
                            New command
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rotate.isPending}
                            onClick={() => {
                              if (
                                confirm(
                                  `Revoke access for "${r.name}"? It will stop reporting until you run the new command on it.`,
                                )
                              ) {
                                rotate.mutate({ id: r.id, revoke: true });
                              }
                            }}
                          >
                            Revoke access
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
