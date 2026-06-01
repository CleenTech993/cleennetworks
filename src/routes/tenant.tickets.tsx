import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/tenant/tickets")({ component: Tickets });

function Tickets() {
  const { tenantId } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: "", body: "" });

  const { data } = useQuery({
    queryKey: ["tickets"],
    queryFn: async () => {
      const { data } = await supabase
        .from("support_tickets")
        .select("id,subject,body,status,created_at")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const { error } = await supabase.from("support_tickets").insert({ tenant_id: tenantId, ...form });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ticket created");
      setOpen(false);
      setForm({ subject: "", body: "" });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("support_tickets").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });

  return (
    <div>
      <PageHeader
        title="Support"
        description="Customer tickets and internal notes."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button>New ticket</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New ticket</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Subject</Label><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="mt-1" /></div>
                <div><Label>Details</Label><Textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="mt-1" /></div>
                <Button onClick={() => create.mutate()} disabled={!form.subject || create.isPending}>{create.isPending ? "Creating…" : "Create"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />
      {!data?.length ? (
        <EmptyState title="No tickets" description="Customer issues will appear here." />
      ) : (
        <div className="space-y-3">
          {data.map((t) => (
            <div key={t.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-medium">{t.subject}</h3>
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{t.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</p>
                </div>
                <select
                  value={t.status}
                  onChange={(e) => setStatus.mutate({ id: t.id, status: e.target.value })}
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                >
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
