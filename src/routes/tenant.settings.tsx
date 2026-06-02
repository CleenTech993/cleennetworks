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

const empty = {
  name: "", primary_color: "",
  mpesa_shortcode: "", mpesa_paybill: "", mpesa_till: "", mpesa_env: "sandbox",
  mpesa_consumer_key: "", mpesa_consumer_secret: "", mpesa_passkey: "",
};

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
  const [form, setForm] = useState(empty);
  useEffect(() => {
    if (tenant) setForm({
      name: tenant.name ?? "",
      primary_color: tenant.primary_color ?? "",
      mpesa_shortcode: tenant.mpesa_shortcode ?? "",
      mpesa_paybill: tenant.mpesa_paybill ?? "",
      mpesa_till: tenant.mpesa_till ?? "",
      mpesa_env: tenant.mpesa_env ?? "sandbox",
      mpesa_consumer_key: tenant.mpesa_consumer_key ?? "",
      mpesa_consumer_secret: tenant.mpesa_consumer_secret ?? "",
      mpesa_passkey: tenant.mpesa_passkey ?? "",
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

  const slug = (tenant as { slug?: string } | undefined)?.slug;
  const portalUrl = slug && typeof window !== "undefined" ? `${window.location.origin}/p/${slug}` : "";
  const callbackUrl = tenantId && typeof window !== "undefined" ? `${window.location.origin}/api/public/mpesa/callback/${tenantId}` : "";

  function field<K extends keyof typeof form>(k: K, label: string, placeholder?: string, type: string = "text") {
    return (
      <div>
        <Label>{label}</Label>
        <Input type={type} value={form[k]} placeholder={placeholder}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Settings" description="Workspace branding and M-Pesa Daraja credentials." />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          <h3 className="font-semibold mb-4">Branding</h3>
          <div className="space-y-3">
            {field("name", "ISP name")}
            {field("primary_color", "Primary color", "#0ea5e9")}
            {portalUrl && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <p className="text-muted-foreground">Public captive portal</p>
                <a href={portalUrl} target="_blank" rel="noreferrer" className="font-mono text-primary break-all">{portalUrl}</a>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <h3 className="font-semibold mb-1">M-Pesa Daraja</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Use sandbox credentials while testing. Switch to <b>production</b> when go-live keys are issued by Safaricom.
          </p>
          <div className="space-y-3">
            <div>
              <Label>Environment</Label>
              <select className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={form.mpesa_env} onChange={(e) => setForm({ ...form, mpesa_env: e.target.value })}>
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field("mpesa_shortcode", "Shortcode")}
              {field("mpesa_paybill", "PayBill")}
            </div>
            {field("mpesa_till", "Till number")}
            {field("mpesa_consumer_key", "Consumer key")}
            {field("mpesa_consumer_secret", "Consumer secret", undefined, "password")}
            {field("mpesa_passkey", "Lipa na M-Pesa passkey", undefined, "password")}
            {callbackUrl && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <p className="text-muted-foreground">Daraja callback URL (whitelist in Safaricom portal)</p>
                <code className="font-mono break-all">{callbackUrl}</code>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-6"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save changes</Button></div>
    </div>
  );
}
