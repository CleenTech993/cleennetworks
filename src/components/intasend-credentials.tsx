import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, ShieldCheck, Trash2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  removeIntasendCredential,
  saveIntasendCredentials,
  testIntasendConnection,
  type GatewayStatus,
} from "@/lib/gateway.functions";

const SOURCE_LABEL = { dashboard: "Saved here", environment: "From server environment" } as const;

/** A random shared string for the webhook "challenge" (24 random bytes, base64url). */
function generateChallenge(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function IntasendCredentials({ status, webhookUrl }: { status: GatewayStatus["intasend"] | undefined; webhookUrl: string }) {
  const qc = useQueryClient();
  const [secretKey, setSecretKey] = useState("");
  const [challenge, setChallenge] = useState("");
  const [generated, setGenerated] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["gateway-status"] });

  const save = useMutation({
    mutationFn: () =>
      saveIntasendCredentials({ data: { secretKey: secretKey || undefined, webhookChallenge: challenge || undefined } }),
    onSuccess: () => {
      // Secrets never stay in the page after saving, and are never sent back by the server.
      setSecretKey("");
      setChallenge("");
      setGenerated(false);
      toast.success("IntaSend credentials saved");
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (name: "INTASEND_SECRET_KEY" | "INTASEND_WEBHOOK_CHALLENGE") => removeIntasendCredential({ data: { name } }),
    onSuccess: () => {
      toast.success("Removed. Any server environment value applies again.");
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => testIntasendConnection(),
    onSuccess: ({ result }) => {
      if (result === "accepted") toast.success(`IntaSend accepted the key${status?.mode ? ` (${status.mode} mode)` : ""}`);
      else if (result === "rejected") toast.error("IntaSend rejected the key. Check you copied the whole secret key.");
      else if (result === "not_set") toast.error("No secret key is set yet.");
      else toast.error("Could not reach IntaSend. Try again in a moment.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const key = status?.key;
  const chal = status?.challenge;
  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`));
  };

  const placeholderFor = (s: typeof key, fallback: string) =>
    s?.set ? `Saved (ends in ${s.last4})` : fallback;

  const state = (s: typeof key) => (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      {s?.set && s.source && <Badge variant="outline">{SOURCE_LABEL[s.source]}</Badge>}
      {s?.needsReentry && <Badge variant="destructive">Saved value unreadable, enter it again</Badge>}
      {!s?.set && <Badge variant="secondary">Not set</Badge>}
    </div>
  );

  return (
    <div className="space-y-5 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">IntaSend credentials</h3>
        {status?.mode && <Badge variant={status.mode === "live" ? "success" : "warning"}>{status.mode === "live" ? "Live keys" : "Sandbox keys"}</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        Stored encrypted on the server and never shown again. This page only ever sees the last 4 characters.
      </p>

      <div>
        <Label htmlFor="is-key">Secret key</Label>
        <div className="mt-1 flex gap-2">
          <Input
            id="is-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder={placeholderFor(key, "ISSecretKey_test_… or ISSecretKey_live_…")}
          />
          {key?.source === "dashboard" && (
            <Button type="button" variant="outline" size="icon" aria-label="Remove saved secret key" disabled={remove.isPending} onClick={() => remove.mutate("INTASEND_SECRET_KEY")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        {state(key)}
      </div>

      <div>
        <Label htmlFor="is-chal">Webhook challenge</Label>
        <div className="mt-1 flex gap-2">
          <Input
            id="is-chal"
            type={generated ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={challenge}
            onChange={(e) => {
              setChallenge(e.target.value);
              setGenerated(false);
            }}
            placeholder={placeholderFor(chal, "A secret string you also enter in IntaSend")}
            className={generated ? "font-mono" : undefined}
          />
          <Button type="button" variant="outline" size="icon" aria-label="Generate a random challenge" onClick={() => { setChallenge(generateChallenge()); setGenerated(true); }}>
            <Wand2 className="h-4 w-4" />
          </Button>
          {generated && (
            <Button type="button" variant="outline" size="icon" aria-label="Copy the challenge" onClick={() => copy(challenge, "Challenge")}>
              <Copy className="h-4 w-4" />
            </Button>
          )}
          {chal?.source === "dashboard" && (
            <Button type="button" variant="outline" size="icon" aria-label="Remove saved webhook challenge" disabled={remove.isPending} onClick={() => remove.mutate("INTASEND_WEBHOOK_CHALLENGE")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        {generated && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Copy this into IntaSend before you save. It can't be shown again afterwards.
          </p>
        )}
        {state(chal)}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending || (!secretKey && !challenge)}>
          {save.isPending ? "Saving…" : "Save credentials"}
        </Button>
        <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !key?.set}>
          {test.isPending ? "Testing…" : "Test connection"}
        </Button>
      </div>

      <div className="space-y-1.5 rounded-md bg-muted/50 p-3 text-xs">
        <p className="text-sm font-medium">Setup</p>
        <p>1. In the IntaSend dashboard, copy your secret key (test keys to try it out, live keys to take real payments) and paste it above.</p>
        <p>
          2. In IntaSend go to Settings → Webhooks → New, and set the endpoint to:
        </p>
        <div className="flex items-center gap-2">
          <code className="select-all break-all">{webhookUrl}</code>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="Copy webhook URL" onClick={() => copy(webhookUrl, "Webhook URL")}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p>3. Use the same challenge string there, and subscribe to <code>collection_event</code>.</p>
        <p>4. Press Test connection, then choose IntaSend as the active gateway and save.</p>
      </div>
    </div>
  );
}
