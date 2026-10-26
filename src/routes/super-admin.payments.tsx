import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { IntasendCredentials } from "@/components/intasend-credentials";
import { getGatewayStatus } from "@/lib/gateway.functions";

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
  active_provider: "intasend",
};

function PlatformPayments() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({
    queryKey: ["platform-mpesa"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_mpesa_config")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: gateways } = useQuery({
    queryKey: ["gateway-status"],
    queryFn: () => getGatewayStatus(),
  });
  const [form, setForm] = useState(empty);
  useEffect(() => {
    if (cfg)
      setForm({
        mpesa_env: cfg.mpesa_env ?? "sandbox",
        shortcode: cfg.shortcode ?? "",
        consumer_key: cfg.consumer_key ?? "",
        consumer_secret: cfg.consumer_secret ?? "",
        passkey: cfg.passkey ?? "",
        callback_base_url: cfg.callback_base_url ?? "",
        validation_url: cfg.validation_url ?? "",
        confirmation_url: cfg.confirmation_url ?? "",
        active_provider: cfg.active_provider ?? "intasend",
      });
  }, [cfg]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("platform_mpesa_config")
        .update({ ...form, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Platform M-Pesa updated");
      qc.invalidateQueries({ queryKey: ["platform-mpesa"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function field<K extends keyof typeof form>(
    k: K,
    label: string,
    placeholder?: string,
    type: string = "text",
  ) {
    return (
      <div>
        <Label>{label}</Label>
        <Input
          type={type}
          value={form[k]}
          placeholder={placeholder}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          className="mt-1"
        />
      </div>
    );
  }

  const origin = (
    form.callback_base_url || (typeof window !== "undefined" ? window.location.origin : "")
  ).replace(/\/$/, "");
  const webhookUrl = `${origin}/api/public/intasend/webhook`;
  const ok = (v: boolean | undefined, yes: string, no: string) => (
    <Badge variant={v ? "default" : "secondary"}>{v ? yes : no}</Badge>
  );

  return (
    <div>
      <PageHeader
        title="Platform Payments"
        description="Payment gateway used by every tenant portal."
      />
      <div className="rounded-xl border bg-card p-5 max-w-3xl space-y-5">
        <div>
          <Label>Active gateway</Label>
          <Select
            value={form.active_provider}
            onValueChange={(v) => setForm({ ...form, active_provider: v })}
          >
            <SelectTrigger className="mt-1 max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="intasend">IntaSend (default)</SelectItem>
              <SelectItem value="payhero">PayHero</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-2">
            New payments use this gateway. Payments already started keep using the one that created
            them, so switching is safe.
          </p>
          {gateways && (
            <p className="mt-2 text-sm">
              Checkouts are using{" "}
              <strong>
                {gateways.effective === "intasend"
                  ? "IntaSend"
                  : gateways.effective === "payhero"
                    ? "PayHero"
                    : "no gateway"}
              </strong>{" "}
              right now.
              {gateways.effective === null && (
                <span className="text-destructive">
                  {" "}
                  Neither gateway has its credentials set, so customers cannot pay.
                </span>
              )}
              {gateways.effective !== null &&
                gateways.effective !== (cfg?.active_provider ?? "intasend") && (
                  <span className="text-destructive">
                    {" "}
                    The selected gateway has no credentials yet, so payments fall back to the other
                    one.
                  </span>
                )}
            </p>
          )}
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <div className="font-medium mb-1">PayHero</div>
            {ok(gateways?.payhero, "Server secrets set", "Not configured")}
          </div>
          <div className="rounded-lg border p-3">
            <div className="font-medium mb-1">IntaSend</div>
            <div className="flex flex-wrap gap-1">
              {ok(gateways?.intasend.secretKey, "Secret key set", "Secret key missing")}
              {gateways?.intasend.mode && (
                <Badge variant="outline">
                  {gateways.intasend.mode === "live" ? "Live keys" : "Sandbox keys"}
                </Badge>
              )}
              {gateways?.intasend.pub.set ? (
                <Badge variant="success">API key set</Badge>
              ) : (
                <Badge variant="outline">API key not set</Badge>
              )}
              {gateways?.intasend.webhookChallenge ? (
                <Badge variant="success">Webhook on</Badge>
              ) : (
                <Badge variant="outline">Webhook off (optional)</Badge>
              )}
            </div>
          </div>
        </div>

        <IntasendCredentials status={gateways?.intasend} webhookUrl={webhookUrl} />

        <div className="space-y-3">
          {field(
            "callback_base_url",
            "Callback base URL (optional)",
            "https://cleennetworks.lovable.app",
          )}
        </div>
        <div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
