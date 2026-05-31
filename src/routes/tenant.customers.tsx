import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

export const Route = createFileRoute("/tenant/customers")({ component: Customers });

function Customers() {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", customer_type: "hotspot", pppoe_username: "" });

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const { error } = await supabase.from("customers").insert({
        tenant_id: tenantId,
        full_name: form.full_name,
        phone: form.phone,
        customer_type: form.customer_type,
        pppoe_username: form.customer_type === "pppoe" ? form.pppoe_username : null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Customer added"); qc.invalidateQueries({ queryKey: ["customers"] }); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Hotspot and PPPoE subscribers."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Add customer</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New customer</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Full name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="2547XXXXXXXX" /></div>
                <div>
                  <Label>Type</Label>
                  <Select value={form.customer_type} onValueChange={(v) => setForm({ ...form, customer_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hotspot">Hotspot</SelectItem>
                      <SelectItem value="pppoe">PPPoE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.customer_type === "pppoe" && (
                  <div><Label>PPPoE username</Label><Input value={form.pppoe_username} onChange={(e) => setForm({ ...form, pppoe_username: e.target.value })} /></div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => create.mutate()} disabled={create.isPending || !form.full_name}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : !customers?.length ? <EmptyState title="No customers" description="Add your first hotspot or PPPoE customer." />
        : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr><th className="px-4 py-2.5 text-left">Name</th><th className="px-4 py-2.5 text-left">Phone</th><th className="px-4 py-2.5 text-left">Type</th><th className="px-4 py-2.5 text-left">Status</th></tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-4 py-2.5 font-medium">{c.full_name}</td>
                    <td className="px-4 py-2.5">{c.phone ?? "—"}</td>
                    <td className="px-4 py-2.5"><Badge variant="outline">{c.customer_type}</Badge></td>
                    <td className="px-4 py-2.5"><Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
