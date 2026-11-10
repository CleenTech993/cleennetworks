import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
import { deleteVouchers, updateVoucher } from "@/lib/voucher.functions";

/** ISO timestamp -> value for <input type="datetime-local"> (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

type VoucherRow = {
  id: string;
  code: string;
  status: string;
  expires_at: string | null;
  used_at: string | null;
  created_at: string;
  package_id: string | null;
};

export function VoucherManager() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<VoucherRow | null>(null);
  const [editPackageId, setEditPackageId] = useState("");
  const [editExpiry, setEditExpiry] = useState("");

  const { data: packages = [] } = useQuery({
    queryKey: ["voucher-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packages")
        .select("id,name,kind,price,active,duration_value,duration_unit")
        .in("kind", ["hotspot", "voucher"])
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const pkgName = useMemo(() => new Map(packages.map((p) => [p.id, p.name])), [packages]);

  const { data: vouchers = [] } = useQuery({
    queryKey: ["vouchers"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vouchers")
        .select("id,code,status,expires_at,used_at,created_at,package_id")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await deleteVouchers({ data: { ids } });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      toast.success(`${res.deleted} voucher${res.deleted === 1 ? "" : "s"} deleted`);
      setConfirmDelete(null);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["vouchers"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete vouchers"),
  });

  function startEdit(v: VoucherRow) {
    setEditing(v);
    setEditPackageId(v.package_id ?? "");
    setEditExpiry(toLocalInput(v.expires_at));
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const changedPkg =
        editPackageId && editPackageId !== editing.package_id ? editPackageId : undefined;
      const oldExpiry = toLocalInput(editing.expires_at);
      const changedExpiry = editExpiry !== oldExpiry;
      const res = await updateVoucher({
        data: {
          id: editing.id,
          packageId: changedPkg,
          expiresAt: changedExpiry
            ? editExpiry
              ? new Date(editExpiry).toISOString()
              : null
            : undefined,
        },
      });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Voucher updated");
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["vouchers"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the voucher"),
  });

  const shown = vouchers.filter(
    (v) =>
      (statusFilter === "all" || v.status === statusFilter) &&
      (!search || v.code.includes(search.trim().toUpperCase())),
  );
  const unused = vouchers.filter((v) => v.status === "unused").length;
  const shownIds = shown.map((v) => v.id);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  const selectedCount = shownIds.filter((id) => selected.has(id)).length;
  const toggleOne = (id: string, on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const toggleAll = (on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      for (const id of shownIds) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const deleteTargets = confirmDelete ? vouchers.filter((v) => confirmDelete.includes(v.id)) : [];
  const deleteUsed = deleteTargets.filter((v) => v.status !== "unused").length;

  return (
    <div className="space-y-6">
      <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        New hotspot access uses the M-Pesa transaction code. Existing vouchers remain available
        below until they expire.
      </p>

      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h3 className="font-semibold">
            Existing vouchers{" "}
            <span className="ml-1 text-sm font-normal text-muted-foreground">{unused} unused</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {selectedCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-destructive"
                onClick={() => setConfirmDelete(shownIds.filter((id) => selected.has(id)))}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete {selectedCount} selected
              </Button>
            )}
            <Input
              placeholder="Search code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-36"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="unused">Unused</SelectItem>
                <SelectItem value="used">Used</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-2">
                  <Checkbox
                    checked={allShownSelected}
                    onCheckedChange={(c) => toggleAll(c === true)}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-2 text-left">Code</th>
                <th className="px-4 py-2 text-left">Package</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Created</th>
                <th className="px-4 py-2 text-left">Expires / sell by</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => {
                const expired = !!v.expires_at && new Date(v.expires_at).getTime() < Date.now();
                return (
                  <tr key={v.id} className="border-t">
                    <td className="px-4 py-2">
                      <Checkbox
                        checked={selected.has(v.id)}
                        onCheckedChange={(c) => toggleOne(v.id, c === true)}
                        aria-label={`Select ${v.code}`}
                      />
                    </td>
                    <td className="px-4 py-2 font-mono tracking-wider">{v.code}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {(v.package_id && pkgName.get(v.package_id)) || "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        variant={
                          expired ? "warning" : v.status === "unused" ? "success" : "secondary"
                        }
                      >
                        {expired ? "expired" : v.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {v.expires_at ? new Date(v.expires_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={`Edit ${v.code}`}
                          onClick={() => startEdit(v)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          aria-label={`Delete ${v.code}`}
                          onClick={() => setConfirmDelete([v.id])}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No vouchers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Showing the latest 200 vouchers.
        </p>
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit voucher</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4">
              <div className="flex items-center gap-3">
                <code className="rounded-md bg-muted px-3 py-1.5 font-mono tracking-widest">
                  {editing.code}
                </code>
                <Badge variant={editing.status === "unused" ? "success" : "secondary"}>
                  {editing.status}
                </Badge>
              </div>
              <div>
                <Label>Package</Label>
                <Select
                  value={editPackageId}
                  onValueChange={setEditPackageId}
                  disabled={editing.status !== "unused"}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose a package" />
                  </SelectTrigger>
                  <SelectContent>
                    {packages.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {p.duration_value} {p.duration_unit} · KES {p.price}
                        {p.active ? "" : " (not for sale)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editing.status !== "unused" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    A redeemed voucher can't be moved to another package.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="vexp">
                  {editing.status === "unused" ? "Sell by (optional)" : "Access ends"}
                </Label>
                <Input
                  id="vexp"
                  type="datetime-local"
                  value={editExpiry}
                  onChange={(e) => setEditExpiry(e.target.value)}
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {editing.status === "unused"
                    ? "Leave empty for no sell-by date. The package time still starts when it is redeemed."
                    : "Move this later to give the customer more time. It must be in the future."}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || (editing?.status !== "unused" && !editExpiry)}
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {confirmDelete?.length} voucher{confirmDelete?.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Deleted codes stop working on your routers within about 2 minutes and cannot be
              restored.
              {deleteUsed > 0 &&
                ` ${deleteUsed} of them ${deleteUsed === 1 ? "has" : "have"} already been redeemed — those customers will lose access.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && remove.mutate(confirmDelete)}
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
