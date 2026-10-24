import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Copy, Router as RouterIcon, Trash2 } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/tenant/routers")({ component: RoutersPage });

function RoutersPage() {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const { data: routers, isLoading } = useQuery({
    refetchInterval: 30_000,
    queryKey: ["routers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("routers").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const addRouter = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const token = crypto.randomUUID().replace(/-/g, "");
      const { data, error } = await supabase.from("routers").insert({
        tenant_id: tenantId,
        name,
        provision_token: token,
        provision_token_expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Router added — copy the provisioning command below");
      qc.invalidateQueries({ queryKey: ["routers"] });
      setOpen(false);
      setName("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [showCmd, setShowCmd] = useState<Record<string, boolean>>({});
  const delRouter = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("routers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Router deleted");
      qc.invalidateQueries({ queryKey: ["routers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function provisionCommand(token: string) {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `/tool fetch url="${base}/api/public/provision/${token}/router.rsc" mode=https dst-path=auto-config.rsc; /import file-name=auto-config.rsc`;
  }

  return (
    <div>
      <PageHeader
        title="Routers"
        description="MikroTik devices and their provisioning state."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4" /> Add router</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New router</DialogTitle>
                <DialogDescription>Give it a label. You'll get a one-line MikroTik provisioning command.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <Label htmlFor="rname">Name</Label>
                <Input id="rname" placeholder="Site A — Tower 1" value={name} onChange={(e) => setName(e.target.value)} />
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
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !routers?.length ? (
        <EmptyState
          title="No routers yet"
          description="Add a MikroTik device. We'll generate a zero-touch provisioning command you paste into the router terminal."
        />
      ) : (
        <div className="space-y-3">
          {routers.map((r) => (
            <div key={r.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
                    <RouterIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.model ?? "Model pending"} · {r.routeros_version ?? "RouterOS ?"}</p>
                    <p className="text-xs text-muted-foreground">
                      CPU {r.cpu_load ?? r.cpu_usage ?? "—"}% · RAM {r.total_memory_mb && r.free_memory_mb != null ? Math.round(((r.total_memory_mb - r.free_memory_mb) / r.total_memory_mb) * 100) : "—"}% · {r.temperature != null ? `${r.temperature}°C · ` : ""}last seen {r.last_heartbeat_at ?? r.last_seen_at ? new Date((r.last_heartbeat_at ?? r.last_seen_at)!).toLocaleTimeString() : "never"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(() => {
                    const last = r.last_heartbeat_at ?? r.last_seen_at;
                    const live = last ? Date.now() - new Date(last).getTime() < 3 * 60 * 1000 : false;
                    return <Badge variant={live ? "default" : "secondary"}>{r.status === "pending" ? "pending" : live ? "online" : "offline"}</Badge>;
                  })()}
                  <Link to="/tenant/routers/$id" params={{ id: r.id }} className="text-xs text-primary underline">Details</Link>
                  <Button size="sm" variant="ghost" onClick={() => setShowCmd((s) => ({ ...s, [r.id]: !s[r.id] }))}>Setup</Button>
                  <Button size="sm" variant="ghost" aria-label="Delete router" onClick={() => {
                    if (confirm(`Delete router "${r.name}"? Its history will be removed.`)) delRouter.mutate(r.id);
                  }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              {r.provision_token && (r.status === "pending" || showCmd[r.id]) && (
                <div className="mt-3 rounded-md bg-muted p-3 font-mono text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <code className="break-all">{provisionCommand(r.provision_token)}</code>
                    <Button size="sm" variant="ghost" onClick={() => {
                      navigator.clipboard.writeText(provisionCommand(r.provision_token!));
                      toast.success("Copied");
                    }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground font-sans">Paste this into the MikroTik terminal. The router will auto-configure and report back.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
