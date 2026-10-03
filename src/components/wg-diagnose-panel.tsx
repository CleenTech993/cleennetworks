import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { diagnoseTunnel } from "@/lib/wg-diagnose.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function WgDiagnosePanel({ routerId }: { routerId: string }) {
  const run = useServerFn(diagnoseTunnel);
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState("");
  const [notes, setNotes] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await run({ data: { routerId, status, logs, notes: notes || undefined } });
      setDiagnosis(res.diagnosis);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Diagnosis failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Bot className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">AI tunnel diagnosis</h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Paste the router's WireGuard status and logs; AI will diagnose the tunnel and recommend fixes. On the MikroTik
        terminal run: <code className="font-mono">/interface wireguard print detail</code>,{" "}
        <code className="font-mono">/interface wireguard peers print detail</code> and{" "}
        <code className="font-mono">/log print where topics~"wireguard"</code>
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="wg-status">WireGuard status output</Label>
          <Textarea
            id="wg-status"
            rows={6}
            className="font-mono text-xs"
            placeholder="/interface wireguard print detail …"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wg-logs">Connection logs</Label>
          <Textarea
            id="wg-logs"
            rows={6}
            className="font-mono text-xs"
            placeholder="/log print where topics~&quot;wireguard&quot; …"
            value={logs}
            onChange={(e) => setLogs(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Label htmlFor="wg-notes">Notes (optional)</Label>
        <Textarea
          id="wg-notes"
          rows={2}
          placeholder="e.g. tunnel stopped working after ISP outage yesterday"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <Button className="mt-4" onClick={submit} disabled={busy || (!status.trim() && !logs.trim())}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {busy ? "Diagnosing…" : "Diagnose tunnel"}
      </Button>
      {diagnosis && (
        <div className="prose prose-sm mt-4 max-w-none rounded-md bg-muted p-4 dark:prose-invert">
          <pre className="whitespace-pre-wrap font-sans text-sm">{diagnosis}</pre>
        </div>
      )}
    </div>
  );
}
