import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/super-admin/payments")({ component: PlatformPayments });

const empty = {
  mpesa_env: "sandbox",
  shortcode: "",
  consumer_key: "",
  consumer_secret: "",
  passkey: "",
  callback_base_url: "",
  validation_url: "",
  confirmation_url: "",
};

function PlatformPayments() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({
    queryKey: ["platform-mpesa"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_mpesa_config").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [form, setForm] = useState(empty);
  useEffect(() => {
    if (cfg) setForm({
      mpesa_env: cfg.mpesa_env ?? "sandbox",
      shortcode: cfg.shortcode ?? "",
      consumer_key: cfg.consumer_key ?? "",
      consumer_secret: cfg.consumer_secret ?? "",
      passkey: cfg.passkey ?? "",
      callback_base_url: cfg.callback_base_url ?? "",
      validation_url: cfg.validation_url ?? "",
      confirmation_url: cfg.confirmation_url ?? "",
    });
  }, [cfg]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("platform_mpesa_config")
        .update({ ...form, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Platform M-Pesa updated"); qc.invalidateQueries({ queryKey: ["platform-mpesa"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

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
      <PageHeader title="Platform Payments" description="Centralized PayHero gateway — used by every tenant portal." />
      <div className="rounded-lg border bg-card p-5 max-w-3xl">
        <p className="text-xs text-muted-foreground mb-4">
          M-Pesa prompts are sent through PayHero using the platform's saved API username, password and channel ID.
          Tenants only provide where they want to receive payouts (Paybill / Till / bank).
        </p>
        <div className="space-y-3">
          {field("callback_base_url", "Callback base URL (optional)", "https://cleennetworks.lovable.app")}
        </div>
        <div className="mt-5"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></div>
      </div>
    </div>
  );
}
