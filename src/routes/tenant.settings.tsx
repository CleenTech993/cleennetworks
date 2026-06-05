import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/tenant/settings")({ component: Settings });

const empty = {
  name: "",
  primary_color: "",
  mpesa_paybill: "",
  mpesa_till: "",
  bank_name: "",
  bank_account_name: "",
  bank_account_number: "",
  bank_branch: "",
  payment_instructions: "",
  support_phone: "",
  support_email: "",
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
    if (tenant) {
      const t = tenant as unknown as Record<string, string | null>;
      setForm({
        name: t.name ?? "",
        primary_color: t.primary_color ?? "",
        mpesa_paybill: t.mpesa_paybill ?? "",
        mpesa_till: t.mpesa_till ?? "",
        bank_name: t.bank_name ?? "",
        bank_account_name: t.bank_account_name ?? "",
        bank_account_number: t.bank_account_number ?? "",
        bank_branch: t.bank_branch ?? "",
        payment_instructions: t.payment_instructions ?? "",
        support_phone: t.support_phone ?? "",
        support_email: t.support_email ?? "",
      });
    }
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

  function field<K extends keyof typeof form>(k: K, label: string, placeholder?: string) {
    return (
      <div>
        <Label>{label}</Label>
        <Input value={form[k]} placeholder={placeholder}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Settings" description="Branding, receiving details, and customer support." />
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
          <h3 className="font-semibold mb-1">Receiving details</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Customers pay through the platform M-Pesa API (managed by Super Admin). These details are used for your settlement
            records and shown to customers for manual deposits — they are <b>not</b> API credentials.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {field("mpesa_paybill", "M-Pesa PayBill")}
              {field("mpesa_till", "M-Pesa Till / Buy Goods")}
            </div>
            {field("bank_name", "Bank name")}
            <div className="grid grid-cols-2 gap-3">
              {field("bank_account_name", "Account name")}
              {field("bank_account_number", "Account number")}
            </div>
            {field("bank_branch", "Branch")}
            <div>
              <Label>Payment instructions</Label>
              <Textarea
                value={form.payment_instructions}
                onChange={(e) => setForm({ ...form, payment_instructions: e.target.value })}
                placeholder="e.g. Use your phone number as the account reference."
                className="mt-1"
              />
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-5 md:col-span-2">
          <h3 className="font-semibold mb-4">Customer support</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {field("support_phone", "Support phone / WhatsApp")}
            {field("support_email", "Support email")}
          </div>
        </div>
      </div>
      <div className="mt-6"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save changes</Button></div>
    </div>
  );
}
