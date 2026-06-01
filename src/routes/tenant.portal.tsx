import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/tenant/portal")({ component: PortalSettings });

function PortalSettings() {
  const { tenantId } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["captive-portal", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("captive_portals").select("*").eq("tenant_id", tenantId!).maybeSingle();
      return data;
    },
  });

  const [form, setForm] = useState({
    primary_color: "#0ea5e9",
    logo_url: "",
    background_url: "",
    welcome_text: "",
    terms_text: "",
    enable_voucher: true,
    enable_otp: true,
  });

  useEffect(() => {
    if (data) {
      setForm({
        primary_color: data.primary_color ?? "#0ea5e9",
        logo_url: data.logo_url ?? "",
        background_url: data.background_url ?? "",
        welcome_text: data.welcome_text ?? "",
        terms_text: data.terms_text ?? "",
        enable_voucher: data.enable_voucher ?? true,
        enable_otp: data.enable_otp ?? true,
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const payload = { tenant_id: tenantId, ...form };
      if (data?.id) {
        const { error } = await supabase.from("captive_portals").update(payload).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("captive_portals").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Captive portal updated");
      qc.invalidateQueries({ queryKey: ["captive-portal"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader title="Captive Portal" description="Branding, themes and login methods for your captive portal." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2 rounded-lg border bg-card p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Primary color</Label>
              <Input type="color" value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} className="mt-1 h-10 w-full p-1" />
            </div>
            <div>
              <Label>Logo URL</Label>
              <Input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://…/logo.png" className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Background image URL</Label>
            <Input value={form.background_url} onChange={(e) => setForm({ ...form, background_url: e.target.value })} placeholder="https://…/bg.jpg" className="mt-1" />
          </div>
          <div>
            <Label>Welcome text</Label>
            <Textarea rows={2} value={form.welcome_text} onChange={(e) => setForm({ ...form, welcome_text: e.target.value })} placeholder="Welcome to FastNet Wi-Fi. Choose a plan to get online." className="mt-1" />
          </div>
          <div>
            <Label>Terms &amp; conditions</Label>
            <Textarea rows={4} value={form.terms_text} onChange={(e) => setForm({ ...form, terms_text: e.target.value })} className="mt-1" />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.enable_voucher} onCheckedChange={(v) => setForm({ ...form, enable_voucher: v })} /> Voucher login
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.enable_otp} onCheckedChange={(v) => setForm({ ...form, enable_otp: v })} /> Phone OTP
            </label>
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Live preview</p>
          <div className="mt-3 overflow-hidden rounded-md border" style={{ background: form.background_url ? `url(${form.background_url}) center/cover` : "#0f172a" }}>
            <div className="bg-black/40 p-6 text-white">
              {form.logo_url && <img src={form.logo_url} alt="logo" className="mb-3 h-8" />}
              <h3 className="text-lg font-semibold" style={{ color: form.primary_color }}>Connect to Wi-Fi</h3>
              <p className="mt-1 text-sm opacity-80">{form.welcome_text || "Welcome — buy a plan to get online."}</p>
              <button className="mt-4 rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ background: form.primary_color }}>
                Buy with M-Pesa
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
