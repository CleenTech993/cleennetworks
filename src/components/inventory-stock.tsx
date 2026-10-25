import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/dashboard-shell";
import { NONE, useCustomerOptions, useInventoryItems, type InventoryItem } from "@/components/inventory-shared";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  categoryLabel, customerLabel, describeError, formatQty, isLowStock, ITEM_CATEGORIES, MOVE_REASONS, type MoveReason,
} from "@/lib/inventory";

type Mode = "receive" | "issue" | "return" | "damaged" | "correct";
const MODE_INFO: Record<Mode, { title: string; reason: MoveReason; cta: string }> = {
  receive: { title: "Receive stock", reason: "received", cta: "Add to stock" },
  issue: { title: "Issue stock", reason: "issued", cta: "Issue" },
  return: { title: "Return to stock", reason: "returned", cta: "Return" },
  damaged: { title: "Damaged or lost", reason: "damaged", cta: "Remove" },
  correct: { title: "Correct stock level", reason: "adjustment", cta: "Save level" },
};

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  for (const k of ["inventory-items", "stock-movements"]) qc.invalidateQueries({ queryKey: [k] });
};

export function StockTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const { data: items, isLoading } = useInventoryItems();
  const [category, setCategory] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [itemDialog, setItemDialog] = useState<{ item: InventoryItem | null } | null>(null);
  const [move, setMove] = useState<{ item: InventoryItem; mode: Mode } | null>(null);
  const [history, setHistory] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);

  const shown = useMemo(
    () => (items ?? []).filter((i) => (category === "all" || i.category === category) && (!lowOnly || isLowStock(i))),
    [items, category, lowOnly],
  );
  const lowCount = (items ?? []).filter(isLowStock).length;
  const totalValue = (items ?? []).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost ?? 0), 0);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("inventory_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Item deleted"); setDeleting(null); invalidate(qc); },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {ITEM_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant={lowOnly ? "default" : "outline"} onClick={() => setLowOnly((v) => !v)}>
          Low stock{lowCount > 0 ? ` (${lowCount})` : ""}
        </Button>
        <span className="text-sm text-muted-foreground">Stock value: KES {totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        {canWrite && <Button className="ml-auto" onClick={() => setItemDialog({ item: null })}><Plus className="h-4 w-4" /> Add item</Button>}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (items ?? []).length === 0 ? (
        <EmptyState title="No stock items yet" description="Add the equipment you keep in store — routers, ONTs, access points, switches, cable — then record what you receive and issue." />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing here" description={lowOnly ? "Nothing is running low." : "No items in this category."} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Item</th><th className="px-4 py-2">Category</th><th className="px-4 py-2 text-right">In stock</th>
                <th className="px-4 py-2 text-right">Reorder at</th><th className="px-4 py-2 text-right">Unit cost</th>
                {canWrite && <th className="px-4 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="px-4 py-2">
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-muted-foreground">{[i.brand, i.model].filter(Boolean).join(" ")}</div>
                  </td>
                  <td className="px-4 py-2">{categoryLabel(i.category)}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="font-medium">{formatQty(i.quantity, i.unit)}</span>
                    {isLowStock(i) && <Badge variant="destructive" className="ml-2">{Number(i.quantity) === 0 ? "Out" : "Low"}</Badge>}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{Number(i.reorder_level) > 0 ? formatQty(i.reorder_level, i.unit) : "—"}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{i.unit_cost != null ? Number(i.unit_cost).toLocaleString() : "—"}</td>
                  {canWrite && (
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => setMove({ item: i, mode: "receive" })}>Receive</Button>{" "}
                      <Button size="sm" variant="outline" onClick={() => setMove({ item: i, mode: "issue" })} disabled={Number(i.quantity) === 0}>Issue</Button>{" "}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setMove({ item: i, mode: "return" })}>Return to stock</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setMove({ item: i, mode: "damaged" })}>Damaged or lost</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setMove({ item: i, mode: "correct" })}>Correct stock level</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setHistory(i)}><History className="mr-2 h-4 w-4" /> History</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setItemDialog({ item: i })}><Pencil className="mr-2 h-4 w-4" /> Edit item</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(i)}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canWrite && (items ?? []).length > 0 && (
        <p className="text-xs text-muted-foreground">You can view stock levels. Technicians and admins record stock movements.</p>
      )}

      {itemDialog && <ItemDialog key={itemDialog.item?.id ?? "new"} item={itemDialog.item} onClose={() => setItemDialog(null)} onSaved={() => { setItemDialog(null); invalidate(qc); }} />}
      {move && <MoveDialog key={move.item.id + move.mode} item={move.item} mode={move.mode} onClose={() => setMove(null)} onSaved={() => { setMove(null); invalidate(qc); }} />}
      {history && <HistoryDialog item={history} onClose={() => setHistory(null)} />}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The item and its stock history are removed. Registered devices stay, but are no longer linked to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ItemDialog({ item, onClose, onSaved }: { item: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const { tenantId } = useAuth();
  const [f, setF] = useState({
    name: item?.name ?? "", category: item?.category ?? "access_point", unit: item?.unit ?? "pcs",
    brand: item?.brand ?? "", model: item?.model ?? "", reorder_level: String(item?.reorder_level ?? 0),
    unit_cost: item?.unit_cost != null ? String(item.unit_cost) : "", notes: item?.notes ?? "", opening: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Give the item a name.");
      const reorder = Number(f.reorder_level || 0);
      const cost = f.unit_cost.trim() === "" ? null : Number(f.unit_cost);
      if (!Number.isFinite(reorder) || reorder < 0) throw new Error("Reorder level must be 0 or more.");
      if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new Error("Unit cost must be 0 or more.");
      const fields = {
        name: f.name.trim(), category: f.category, unit: f.unit, brand: f.brand.trim() || null, model: f.model.trim() || null,
        reorder_level: reorder, unit_cost: cost, notes: f.notes.trim() || null,
      };
      if (item) {
        const { error } = await supabase.from("inventory_items").update(fields).eq("id", item.id);
        if (error) throw error;
        return;
      }
      if (!tenantId) throw new Error("No tenant");
      const { data, error } = await supabase.from("inventory_items").insert({ tenant_id: tenantId, ...fields }).select("id").single();
      if (error) throw error;
      const opening = Number(f.opening || 0);
      if (opening > 0) {
        const { error: mErr } = await supabase.from("stock_movements").insert({
          tenant_id: tenantId, item_id: data.id, change: opening, reason: "received", note: "Opening stock",
        });
        if (mErr) throw mErr;
      }
    },
    onSuccess: () => { toast.success(item ? "Item updated" : "Item added"); onSaved(); },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit item" : "Add stock item"}</DialogTitle>
          <DialogDescription>An item is a kind of equipment you keep in store. Stock levels change only by recording movements.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div><Label>Name</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Cat6 cable box" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={f.category} onValueChange={(v) => { set("category", v); if (!item) set("unit", v === "cable" ? "m" : "pcs"); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ITEM_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Counted in</Label>
              <Select value={f.unit} onValueChange={(v) => set("unit", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="pcs">Pieces</SelectItem><SelectItem value="m">Metres</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Brand</Label><Input value={f.brand} onChange={(e) => set("brand", e.target.value)} /></div>
            <div><Label>Model</Label><Input value={f.model} onChange={(e) => set("model", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Warn me when stock reaches</Label><Input type="number" min={0} value={f.reorder_level} onChange={(e) => set("reorder_level", e.target.value)} /></div>
            <div><Label>Unit cost (KES)</Label><Input type="number" min={0} value={f.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} /></div>
          </div>
          {!item && <div><Label>Opening stock</Label><Input type="number" min={0} value={f.opening} onChange={(e) => set("opening", e.target.value)} placeholder="How many do you have now?" /></div>}
          <div><Label>Notes</Label><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({ item, mode, onClose, onSaved }: { item: InventoryItem; mode: Mode; onClose: () => void; onSaved: () => void }) {
  const { tenantId } = useAuth();
  const info = MODE_INFO[mode];
  const { data: customers } = useCustomerOptions();
  const [qty, setQty] = useState(mode === "correct" ? String(Number(item.quantity)) : "");
  const [customer, setCustomer] = useState(NONE);
  const [note, setNote] = useState("");
  const showCustomer = mode === "issue" || mode === "return";

  const save = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const n = Number(qty);
      if (!Number.isFinite(n) || qty.trim() === "") throw new Error("Enter a quantity.");
      if (mode !== "correct" && n <= 0) throw new Error("Quantity must be more than zero.");
      if (mode === "correct" && n < 0) throw new Error("Stock level can't be negative.");
      if (item.unit === "pcs" && !Number.isInteger(n)) throw new Error("Pieces must be whole numbers.");
      const change = mode === "correct" ? n - Number(item.quantity) : mode === "issue" || mode === "damaged" ? -n : n;
      if (change === 0) throw new Error("That is already the current stock level.");
      const { error } = await supabase.from("stock_movements").insert({
        tenant_id: tenantId, item_id: item.id, change, reason: info.reason,
        customer_id: showCustomer && customer !== NONE ? customer : null, note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Stock updated"); onSaved(); },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{info.title}: {item.name}</DialogTitle>
          <DialogDescription>Currently {formatQty(item.quantity, item.unit)} in stock.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>{mode === "correct" ? `New stock level (${item.unit === "m" ? "metres" : "pieces"})` : `Quantity (${item.unit === "m" ? "metres" : "pieces"})`}</Label>
            <Input type="number" min={0} step={item.unit === "m" ? "any" : 1} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
          </div>
          {showCustomer && (
            <div>
              <Label>{mode === "issue" ? "Given to customer (optional)" : "Returned by customer (optional)"}</Label>
              <Select value={customer} onValueChange={setCustomer}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value={NONE}>No customer</SelectItem>
                  {(customers ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{customerLabel(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div><Label>Note (optional)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "receive" ? "Supplier, invoice no…" : ""} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : info.cta}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { data: customers } = useCustomerOptions();
  const byId = useMemo(() => new Map((customers ?? []).map((c) => [c.id, c])), [customers]);
  const { data: moves, isLoading } = useQuery({
    queryKey: ["stock-movements", item.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("stock_movements").select("*").eq("item_id", item.id).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Stock history: {item.name}</DialogTitle>
          <DialogDescription>Every change to the stock level, newest first. Entries can't be edited.</DialogDescription>
        </DialogHeader>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (moves ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {(moves ?? []).map((m) => {
              const c = m.customer_id ? byId.get(m.customer_id) : null;
              return (
                <li key={m.id} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <div className="font-medium">{MOVE_REASONS[m.reason as MoveReason] ?? m.reason}{c ? ` · ${customerLabel(c)}` : ""}</div>
                    <div className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}{m.note ? ` · ${m.note}` : ""}</div>
                  </div>
                  <span className={Number(m.change) > 0 ? "font-medium text-success" : "font-medium text-destructive"}>
                    {Number(m.change) > 0 ? "+" : ""}{formatQty(m.change, item.unit)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
