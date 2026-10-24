import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/tenant/packages")({ component: Packages });

function Packages() {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", price: "", kind: "hotspot",
    duration_value: "1", duration_unit: "hours",
    download_kbps: "5000", upload_kbps: "2000",
  });

  const { data: packages, isLoading } = useQuery({
    queryKey: ["packages"],
    queryFn: async () => {
      const { data, error } = await supabase.from("packages").select("*").order("created_at", { ascending: false });
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
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Package created");
      qc.invalidateQueries({ queryKey: ["packages"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Packages"
        description="Hotspot, PPPoE and voucher plans available to customers."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> New package</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create package</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Price (KES)</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
                  <div>
                    <Label>Kind</Label>
                    <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hotspot">Hotspot</SelectItem>
                        <SelectItem value="pppoe">PPPoE</SelectItem>
                        <SelectItem value="voucher">Voucher</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Duration</Label><Input type="number" value={form.duration_value} onChange={(e) => setForm({ ...form, duration_value: e.target.value })} /></div>
                  <div>
                    <Label>Unit</Label>
                    <Select value={form.duration_unit} onValueChange={(v) => setForm({ ...form, duration_unit: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["minutes","hours","days","weeks","months"].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Download (kbps)</Label><Input type="number" value={form.download_kbps} onChange={(e) => setForm({ ...form, download_kbps: e.target.value })} /></div>
                  <div><Label>Upload (kbps)</Label><Input type="number" value={form.upload_kbps} onChange={(e) => setForm({ ...form, upload_kbps: e.target.value })} /></div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => create.mutate()} disabled={!form.name || !form.price || create.isPending}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : !packages?.length ? (
          <EmptyState title="No packages" description="Create your first hotspot or PPPoE package to start selling internet." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {packages.map((p) => (
              <div key={p.id} className="rounded-xl border bg-card p-5">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold">{p.name}</h3>
                  <Badge variant="outline">{p.kind}</Badge>
                </div>
                <p className="mt-2 text-2xl font-bold text-primary">KES {Number(p.price).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{p.duration_value} {p.duration_unit} · {p.download_kbps}/{p.upload_kbps} kbps</p>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
