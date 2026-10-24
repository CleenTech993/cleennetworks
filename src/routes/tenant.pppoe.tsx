import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
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

export const Route = createFileRoute("/tenant/pppoe")({
  head: () => ({
    meta: [
      { title: "PPPoE clients — Tenant console" },
      {
        name: "description",
        content:
          "Create PPPoE logins with a speed and duration, then renew, suspend or remove them.",
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

const NONE = "__none__";
const empty = {
  full_name: "",
  phone: "",
  pppoe_username: "",
  pppoe_password: "",
  package_id: "",
  router_id: NONE,
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
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [form, setForm] = useState(empty);
  const [showPw, setShowPw] = useState(false);
  const [deleting, setDeleting] = useState<Client | null>(null);

  const { data: clients, isLoading } = useQuery({
    queryKey: ["pppoe-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id,full_name,phone,pppoe_username,pppoe_password,status,expires_at,package_id,router_id",
        )
        .eq("customer_type", "pppoe")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Client[];
    },
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
  const { data: routers } = useQuery({
    queryKey: ["routers-min"],
    queryFn: async () => (await supabase.from("routers").select("id,name")).data ?? [],
  });

  const pkgById = useMemo(() => new Map((packages ?? []).map((p) => [p.id, p])), [packages]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["pppoe-customers"] });

  const openNew = () => {
    setForm({ ...empty, pppoe_password: randomCode(8) });
    setEditing("new");
  };
  const openEdit = (c: Client) => {
    setForm({
      full_name: c.full_name ?? "",
      phone: c.phone ?? "",
      pppoe_username: c.pppoe_username ?? "",
      pppoe_password: c.pppoe_password ?? "",
      package_id: c.package_id ?? "",
      router_id: c.router_id ?? NONE,
      expires_at: toLocalInput(c.expires_at),
    });
    setEditing(c);
  };

  // Picking a package on a NEW client pre-fills the expiry from the package duration.
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
      const row = {
        full_name: form.full_name.trim() || null,
        phone: form.phone.trim() || null,
        pppoe_username: form.pppoe_username.trim(),
        pppoe_password: form.pppoe_password.trim(),
        package_id: form.package_id || null,
        router_id: form.router_id === NONE ? null : form.router_id,
        expires_at: fromLocalInput(form.expires_at),
      };
      const { error } =
        editing === "new"
          ? await supabase
              .from("customers")
              .insert({ ...row, tenant_id: tenantId, customer_type: "pppoe", status: "active" })
          : await supabase
              .from("customers")
              .update(row)
              .eq("id", (editing as Client).id);
      if (error)
        throw error.code === "23505"
          ? new Error("That username is already used by another client.")
          : error;
    },
    onSuccess: () => {
      toast.success("Saved — the router picks it up within 2 minutes");
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
      const { error } = await supabase
        .from("customers")
        .update({
          expires_at: renewedExpiry(c.expires_at, pkg.duration_value, pkg.duration_unit),
          status: "active",
        })
        .eq("id", c.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Renewed");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ c, status }: { c: Client; status: "active" | "suspended" }) => {
      const { error } = await supabase.from("customers").update({ status }).eq("id", c.id);
      if (error) throw error;
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
    <div>
      <PageHeader
        title="PPPoE clients"
        description="Give each client a username and password for their router, with the speed and duration of their package."
        action={
          <div className="flex gap-2">
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

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !clients?.length ? (
        <EmptyState
          title="No PPPoE clients"
          description="Add a client to create their PPPoE login. Create a PPPoE package first (Packages page) to set the speed and duration."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">Login</th>
                <th className="px-4 py-2">Package / speed</th>
                <th className="px-4 py-2">Expires</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const pkg = c.package_id ? pkgById.get(c.package_id) : undefined;
                const expired = isExpired(c.expires_at);
                const label = c.status !== "active" ? c.status : expired ? "expired" : "active";
                return (
                  <tr key={c.id} className="border-t align-top">
                    <td className="px-4 py-2 font-medium">
                      {c.full_name ?? "—"}
                      <div className="text-xs font-normal text-muted-foreground">
                        {c.phone ?? ""}
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {c.pppoe_username ?? "—"}
                      <div className="text-muted-foreground">
                        {showPw ? c.pppoe_password : "••••••••"}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {pkg ? (
                        <>
                          {pkg.name}
                          <div className="text-xs text-muted-foreground">
                            ↓ {formatSpeed(pkg.download_kbps)} · ↑ {formatSpeed(pkg.upload_kbps)}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">No package (unlimited)</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {c.expires_at ? new Date(c.expires_at).toLocaleString() : "Never"}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={label === "active" ? "default" : "secondary"}>{label}</Badge>
                    </td>
                    <td className="px-4 py-2">
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

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "New PPPoE client" : "Edit PPPoE client"}
            </DialogTitle>
            <DialogDescription>
              The client enters this username and password in their own router's PPPoE settings.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Full name</Label>
                <Input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
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
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>All routers</SelectItem>
                    {routers?.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.pppoe_username || !form.pppoe_password}
            >
              {editing === "new" ? "Create client" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleting?.full_name ?? deleting?.pppoe_username}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their login is removed from the router within 2 minutes and any live connection is
              dropped.
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
