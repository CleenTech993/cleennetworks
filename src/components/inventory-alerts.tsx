import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Settings2 } from "lucide-react";
import { EmptyState } from "@/components/dashboard-shell";
import { timeAgo } from "@/components/inventory-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { getSmsStatus, sendTestAlert } from "@/lib/alerts.functions";
import { describeError, normalizeAlertNumber } from "@/lib/inventory";

const KIND = {
  device_down: { label: "Offline", variant: "destructive" as const },
  device_up: { label: "Back online", variant: "default" as const },
  low_stock: { label: "Low stock", variant: "secondary" as const },
};

export function AlertsTab({ canManage }: { canManage: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: alerts, isLoading } = useQuery({
    queryKey: ["inventory-alerts"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_alerts").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });
  const { data: sms } = useQuery({ queryKey: ["sms-status"], queryFn: () => getSmsStatus(), enabled: canManage });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          You're alerted when a monitored device stays offline, comes back, or an item runs low on stock.
        </p>
        {canManage && (
          <Button className="ml-auto" variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-4 w-4" /> Alert settings
          </Button>
        )}
      </div>

      {canManage && sms && !sms.configured && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Text messages aren't switched on for this platform yet, so alerts are only recorded here. Ask the platform owner to add the SMS credentials.
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (alerts ?? []).length === 0 ? (
        <EmptyState icon={Bell} title="No alerts yet" description="Nothing has gone wrong. Alerts appear here when a monitored device goes offline for a while or stock runs low." />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Alert</th><th className="px-4 py-2">SMS</th></tr>
            </thead>
            <tbody>
              {(alerts ?? []).map((a) => {
                const k = KIND[a.kind as keyof typeof KIND] ?? { label: a.kind, variant: "outline" as const };
                return (
                  <tr key={a.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground" title={new Date(a.created_at).toLocaleString()}>{timeAgo(a.created_at)}</td>
                    <td className="px-4 py-2"><Badge variant={k.variant} className="mr-2">{k.label}</Badge>{a.message}</td>
                    <td className="px-4 py-2"><SmsBadge status={a.sms_status} error={a.sms_error} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {settingsOpen && <SettingsDialog smsConfigured={sms?.configured} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function SmsBadge({ status, error }: { status: string; error: string | null }) {
  if (status === "sent") return <Badge className="bg-success text-success-foreground">Sent</Badge>;
  if (status === "failed") return <Badge variant="destructive" title={error ?? undefined}>Failed</Badge>;
  if (status === "skipped") return <Badge variant="outline" className="text-muted-foreground" title={error ?? undefined}>Not sent{error ? ` · ${error}` : ""}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Sending…</Badge>;
}

const DELAYS = [1, 3, 5, 10, 15, 30];

function SettingsDialog({ smsConfigured, onClose }: { smsConfigured: boolean | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const { data: current, isLoading } = useQuery({
    queryKey: ["alert-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("alert_settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [numbers, setNumbers] = useState("");
  const [down, setDown] = useState(true);
  const [low, setLow] = useState(true);
  const [delay, setDelay] = useState("5");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (isLoading || loaded) return;
    if (current) {
      setNumbers(current.sms_numbers.join("\n"));
      setDown(current.notify_device_down);
      setLow(current.notify_low_stock);
      setDelay(String(current.down_after_minutes));
    }
    setLoaded(true);
  }, [current, isLoading, loaded]);

  const save = useMutation({
    mutationFn: async (): Promise<number> => {
      if (!tenantId) throw new Error("No tenant");
      const parts = numbers.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
      const normalized = parts.map((p) => ({ raw: p, n: normalizeAlertNumber(p) }));
      const bad = normalized.find((x) => !x.n);
      if (bad) throw new Error(`"${bad.raw}" doesn't look like a phone number. Use e.g. 0712 345 678.`);
      const unique = [...new Set(normalized.map((x) => x.n as string))];
      if (unique.length > 5) throw new Error("You can add up to 5 phone numbers.");
      const { error } = await supabase.from("alert_settings").upsert(
        { tenant_id: tenantId, sms_numbers: unique, notify_device_down: down, notify_low_stock: low, down_after_minutes: Number(delay) },
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
      return unique.length;
    },
  });

  async function saveAndClose() {
    try {
      await save.mutateAsync();
    } catch (e) {
      toast.error(describeError(e));
      return;
    }
    toast.success("Alert settings saved");
    qc.invalidateQueries({ queryKey: ["alert-settings"] });
    onClose();
  }

  const test = useMutation({
    mutationFn: async () => {
      const n = await save.mutateAsync();
      if (n === 0) throw new Error("Add a phone number first.");
      const res = await sendTestAlert();
      if (!res.ok) throw new Error(res.error);
      return res.sentTo;
    },
    onSuccess: (n) => { toast.success(`Test SMS sent to ${n} number${n === 1 ? "" : "s"}`); qc.invalidateQueries({ queryKey: ["alert-settings"] }); },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Alert settings</DialogTitle>
          <DialogDescription>Who gets a text message, and for what.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label>Phone numbers (up to 5, one per line)</Label>
            <Textarea rows={3} value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder={"0712 345 678\n0722 000 111"} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div><p className="text-sm font-medium">Device offline / back online</p><p className="text-xs text-muted-foreground">Texts when a monitored device stays down, and when it recovers.</p></div>
            <Switch checked={down} onCheckedChange={setDown} />
          </div>
          {down && (
            <div>
              <Label>Only if it has been offline for</Label>
              <Select value={delay} onValueChange={setDelay}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DELAYS.map((m) => <SelectItem key={m} value={String(m)}>{m} minute{m === 1 ? "" : "s"}</SelectItem>)}</SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">A longer wait avoids texts for quick reboots.</p>
            </div>
          )}
          <div className="flex items-center justify-between rounded-md border p-3">
            <div><p className="text-sm font-medium">Low stock</p><p className="text-xs text-muted-foreground">Texts when an item drops to its reorder level.</p></div>
            <Switch checked={low} onCheckedChange={setLow} />
          </div>
          {smsConfigured === false && (
            <p className="text-xs text-muted-foreground">SMS isn't switched on for this platform yet. You can still save your settings; texts start once it is.</p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || save.isPending}>{test.isPending ? "Sending…" : "Save & send test"}</Button>
          <Button onClick={saveAndClose} disabled={save.isPending || test.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
