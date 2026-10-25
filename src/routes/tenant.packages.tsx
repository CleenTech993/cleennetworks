import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";
import { updatePackage, deletePackage, PACKAGE_UNITS } from "@/lib/package.functions";

export const Route = createFileRoute("/tenant/packages")({ component: Packages });

type Pkg = Tables<"packages">;
type FormState = {
  name: string;
  price: string;
  kind: string;
  duration_value: string;
  duration_unit: string;
  download_kbps: string;
  upload_kbps: string;
  device_limit: string;
  active: boolean;
};
const EMPTY_FORM: FormState = {
  name: "",
  price: "",
  kind: "hotspot",
  duration_value: "1",
  duration_unit: "hours",
  download_kbps: "5000",
  upload_kbps: "2000",
  device_limit: "1",
  active: true,
};

function PackageFields({
  form,
  setForm,
  kindLocked,
  showActive,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  kindLocked?: boolean;
  showActive?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <div>
        <Label>Name</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Price (KES)</Label>
          <Input
            type="number"
            min={0}
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
        </div>
        <div>
          <Label>Kind</Label>
          {kindLocked ? (
            <div className="mt-2">
              <Badge variant="outline">{form.kind}</Badge>
            </div>
          ) : (
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hotspot">Hotspot</SelectItem>
                <SelectItem value="pppoe">PPPoE</SelectItem>
                <SelectItem value="voucher">Voucher</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Duration</Label>
          <Input
            type="number"
            min={1}
            value={form.duration_value}
            onChange={(e) => setForm({ ...form, duration_value: e.target.value })}
          />
        </div>
        <div>
          <Label>Unit</Label>
          <Select
            value={form.duration_unit}
            onValueChange={(v) => setForm({ ...form, duration_unit: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PACKAGE_UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Download (kbps)</Label>
          <Input
            type="number"
            min={0}
            value={form.download_kbps}
            onChange={(e) => setForm({ ...form, download_kbps: e.target.value })}
          />
        </div>
        <div>
          <Label>Upload (kbps)</Label>
          <Input
            type="number"
            min={0}
            value={form.upload_kbps}
            onChange={(e) => setForm({ ...form, upload_kbps: e.target.value })}
          />
        </div>
      </div>
      {form.kind !== "pppoe" && (
        <div>
          <Label>Devices allowed</Label>
          <Input
            type="number"
            min={1}
            max={10}
            value={form.device_limit}
            onChange={(e) => setForm({ ...form, device_limit: e.target.value })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            1 = one package, one device: a voucher is pinned to the first device that uses it. More
            than 1 lets that many devices use it at the same time.
          </p>
        </div>
      )}
      {showActive && (
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Available for sale</p>
            <p className="text-xs text-muted-foreground">
              Turn off to hide it from the portal and voucher generator.
            </p>
          </div>
          <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
        </div>
      )}
    </div>
  );
}

function Packages() {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<Pkg | null>(null);

  const { data: packages, isLoading } = useQuery({
    queryKey: ["packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packages")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const { error } = await supabase.from("packages").insert({
        tenant_id: tenantId,
        name: form.name,
        price: Number(form.price),
        kind: form.kind,
        duration_value: Number(form.duration_value),
        duration_unit: form.duration_unit,
        download_kbps: Number(form.download_kbps),
        upload_kbps: Number(form.upload_kbps),
        device_limit: Math.min(10, Math.max(1, Math.trunc(Number(form.device_limit)) || 1)),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Package created");
      qc.invalidateQueries({ queryKey: ["packages"] });
      setOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startEdit(p: Pkg) {
    setEditing(p);
    setEditForm({
      name: p.name,
      price: String(p.price),
      kind: p.kind,
      duration_value: String(p.duration_value ?? 1),
      duration_unit: p.duration_unit ?? "hours",
      download_kbps: String(p.download_kbps ?? 0),
      upload_kbps: String(p.upload_kbps ?? 0),
      device_limit: String(p.device_limit ?? 1),
      active: p.active ?? true,
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const res = await updatePackage({
        data: {
          id: editing.id,
          name: editForm.name,
          price: Number(editForm.price),
          duration_value: Number(editForm.duration_value),
          duration_unit: editForm.duration_unit as (typeof PACKAGE_UNITS)[number],
          download_kbps: Number(editForm.download_kbps),
          upload_kbps: Number(editForm.upload_kbps),
          device_limit: Math.min(10, Math.max(1, Math.trunc(Number(editForm.device_limit)) || 1)),
          active: editForm.active,
        },
      });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Package updated");
      qc.invalidateQueries({ queryKey: ["packages"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await deletePackage({ data: { id } });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      if (res.result === "deleted") {
        toast.success(
          res.vouchersRemoved
            ? `Package deleted (${res.vouchersRemoved} unused vouchers removed)`
            : "Package deleted",
        );
      } else {
        toast.success(
          `Package archived — it has sales history (${res.reason}). It is no longer for sale.`,
        );
      }
      qc.invalidateQueries({ queryKey: ["packages"] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editInvalid =
    !editForm.name.trim() ||
    [editForm.price, editForm.duration_value, editForm.download_kbps, editForm.upload_kbps].some(
      (v) => v === "" || Number.isNaN(Number(v)),
    );

  return (
    <div>
      <PageHeader
        title="Packages"
        description="Hotspot, PPPoE and voucher plans available to customers."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" /> New package
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create package</DialogTitle>
              </DialogHeader>
              <PackageFields form={form} setForm={setForm} />
              <DialogFooter>
                <Button
                  onClick={() => create.mutate()}
                  disabled={!form.name || !form.price || create.isPending}
                >
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !packages?.length ? (
        <EmptyState
          title="No packages"
          description="Create your first hotspot or PPPoE package to start selling internet."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {packages.map((p) => (
            <div
              key={p.id}
              className={`rounded-xl border bg-card p-5 ${p.active === false ? "opacity-70" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{p.name}</h3>
                <div className="flex shrink-0 items-center gap-1">
                  {p.active === false && <Badge variant="secondary">Not for sale</Badge>}
                  <Badge variant="outline">{p.kind}</Badge>
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-primary">
                KES {Number(p.price).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">
                {p.duration_value} {p.duration_unit} · {p.download_kbps}/{p.upload_kbps} kbps
                {p.kind !== "pppoe"
                  ? ` · ${p.device_limit ?? 1} device${(p.device_limit ?? 1) === 1 ? "" : "s"}`
                  : ""}
              </p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setDeleting(p)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit package</DialogTitle>
          </DialogHeader>
          <PackageFields form={editForm} setForm={setEditForm} kindLocked showActive />
          <p className="text-xs text-muted-foreground">
            Changes apply to new purchases and to routers on their next sync. Time customers have
            already bought is not changed.
          </p>
          <DialogFooter>
            <Button onClick={() => save.mutate()} disabled={editInvalid || save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              If this package has never been sold, it is deleted along with its unused vouchers. If
              it has payments, customers or redeemed vouchers, it is archived instead: removed from
              sale but kept in your records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
