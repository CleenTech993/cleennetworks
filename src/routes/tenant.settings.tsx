import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/tenant/settings")({ component: Settings });

function Settings() {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const { data: tenant } = useQuery({
    queryKey: ["tenant", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("*").eq("id", tenantId!).single();
      if (error) throw error;
      return data;
    },
  });
  const [form, setForm] = useState({ name: "", primary_color: "", mpesa_shortcode: "", mpesa_paybill: "", mpesa_till: "" });
  useEffect(() => {
    if (tenant) setForm({
      name: tenant.name ?? "",
      primary_color: tenant.primary_color ?? "",
      mpesa_shortcode: tenant.mpesa_shortcode ?? "",
      mpesa_paybill: tenant.mpesa_paybill ?? "",
      mpesa_till: tenant.mpesa_till ?? "",
    });
  }, [tenant]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tenants").update(form).eq("id", tenantId!);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["tenant"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="Settings" description="Workspace branding and M-Pesa Daraja credentials." />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          <h3 className="font-semibold mb-4">Branding</h3>
          <div className="space-y-3">
            <div><Label>ISP name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Primary color</Label><Input value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} placeholder="#0ea5e9" /></div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <h3 className="font-semibold mb-4">M-Pesa Daraja</h3>
          <div className="space-y-3">
            <div><Label>Shortcode</Label><Input value={form.mpesa_shortcode} onChange={(e) => setForm({ ...form, mpesa_shortcode: e.target.value })} /></div>
            <div><Label>PayBill</Label><Input value={form.mpesa_paybill} onChange={(e) => setForm({ ...form, mpesa_paybill: e.target.value })} /></div>
            <div><Label>Till number</Label><Input value={form.mpesa_till} onChange={(e) => setForm({ ...form, mpesa_till: e.target.value })} /></div>
            <p className="text-xs text-muted-foreground">Consumer key, secret and passkey are stored as encrypted secrets — request from support.</p>
          </div>
        </div>
      </div>
      <div className="mt-6"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save changes</Button></div>
    </div>
  );
}
