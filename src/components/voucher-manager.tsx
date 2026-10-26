import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Download, Pencil, Printer, Ticket, Trash2 } from "lucide-react";
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
import { useAuth } from "@/hooks/use-auth";
import {
  deleteVouchers,
  generateVouchers,
  MAX_VOUCHERS_PER_BATCH,
  updateVoucher,
} from "@/lib/voucher.functions";

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

type Batch = { codes: string[]; packageName: string; duration: string; sellBy: string | null };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function downloadCsv(batch: Batch) {
  const rows = [
    "code,package,sell_by",
    ...batch.codes.map((c) => [c, batch.packageName, batch.sellBy ?? ""].map(csvCell).join(",")),
  ];
  const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `vouchers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Must run directly inside a click handler, otherwise the browser blocks the popup.
function printSheet(batch: Batch, ispName: string) {
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("Allow pop-ups to print, or use Download CSV.");
    return;
  }
  const cards = batch.codes
    .map(
      (c) =>
        `<div class="card"><div class="isp">${esc(ispName)}</div><div class="pkg">${esc(batch.packageName)}</div><div class="dur">${esc(batch.duration)}</div><div class="code">${esc(c)}</div></div>`,
    )
    .join("");
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Vouchers</title><style>
      body{font-family:system-ui,sans-serif;margin:16px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
      .card{border:1px dashed #555;padding:10px;text-align:center;break-inside:avoid}
      .isp{font-size:11px;color:#555}.pkg{font-weight:600;margin-top:4px}.dur{font-size:12px;color:#555}
      .code{font:700 20px ui-monospace,monospace;letter-spacing:2px;margin-top:6px}
    </style></head><body><div class="grid">${cards}</div></body></html>`,
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

export function VoucherManager() {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [packageId, setPackageId] = useState("");
  const [quantity, setQuantity] = useState("10");
  const [sellBy, setSellBy] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);
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
  const activePackages = packages.filter((p) => p.active);
  const pkgName = useMemo(() => new Map(packages.map((p) => [p.id, p.name])), [packages]);

  const { data: ispName = "" } = useQuery({
    queryKey: ["tenant-name", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", tenantId!)
        .maybeSingle();
      return data?.name ?? "";
    },
  });

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

  const generate = useMutation({
    mutationFn: async () => {
      const qty = Number(quantity);
      if (!packageId) throw new Error("Choose a package.");
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_VOUCHERS_PER_BATCH) {
        throw new Error(`Enter a quantity between 1 and ${MAX_VOUCHERS_PER_BATCH}.`);
      }
      const res = await generateVouchers({
        data: {
          packageId,
          quantity: qty,
          sellBy: sellBy ? new Date(`${sellBy}T23:59:59`).toISOString() : null,
        },
      });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      const pkg = packages.find((p) => p.id === packageId);
      setBatch({
        codes: res.codes,
        packageName: res.packageName,
        duration: pkg?.duration_value
          ? `${pkg.duration_value} ${pkg.duration_unit ?? ""}`.trim()
          : "",
        sellBy: res.sellBy,
      });
      toast.success(`${res.codes.length} vouchers generated`);
      void qc.invalidateQueries({ queryKey: ["vouchers"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not generate vouchers"),
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
      <div className="rounded-xl border bg-card p-5">
        <h3 className="mb-1 flex items-center gap-2 font-semibold">
          <Ticket className="h-4 w-4" /> Generate vouchers
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Each voucher unlocks one package. The package time starts when a customer redeems it.
          Routers pick up new vouchers within about 2 minutes.
        </p>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label>Package</Label>
            <Select value={packageId} onValueChange={setPackageId}>
              <SelectTrigger className="mt-1">
                <SelectValue
                  placeholder={
                    activePackages.length ? "Choose a package" : "No hotspot packages yet"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {activePackages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.duration_value} {p.duration_unit} · KES {p.price}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="vqty">Quantity (max {MAX_VOUCHERS_PER_BATCH})</Label>
            <Input
              id="vqty"
              type="number"
              min={1}
              max={MAX_VOUCHERS_PER_BATCH}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="vsell">Sell by (optional)</Label>
            <Input
              id="vsell"
              type="date"
              value={sellBy}
              onChange={(e) => setSellBy(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
        <Button
          className="mt-4"
          disabled={generate.isPending || !packageId}
          onClick={() => generate.mutate()}
        >
          {generate.isPending ? "Generating…" : "Generate vouchers"}
        </Button>
      </div>

      {batch && (
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">
              New batch · {batch.codes.length} × {batch.packageName}
            </h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => printSheet(batch, ispName)}>
                <Printer className="h-3.5 w-3.5" /> Print
              </Button>
              <Button size="sm" variant="outline" onClick={() => downloadCsv(batch)}>
                <Download className="h-3.5 w-3.5" /> Download CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(batch.codes.join("\n"));
                  toast.success("Copied");
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
            </div>
          </div>
          <div className="grid max-h-64 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-4">
            {batch.codes.map((c) => (
              <code
                key={c}
                className="rounded-md bg-muted px-3 py-1.5 text-center font-mono text-sm tracking-widest"
              >
                {c}
              </code>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h3 className="font-semibold">
            Recent vouchers{" "}
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
