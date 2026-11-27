import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tenant/developer")({ component: DeveloperApi });

type ApiKeyRecord = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

async function authorizedRequest(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again before managing API keys.");
  return fetch(input, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
}

async function readApiError(response: Response, fallback: string) {
  const payload: unknown = await response.json().catch(() => null);
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function DeveloperApi() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["static_ips:read"]);
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [newKey, setNewKey] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["tenant-api-keys"],
    queryFn: async () => {
      const response = await authorizedRequest("/api/tenant/api-keys");
      if (!response.ok) throw new Error(await readApiError(response, "Could not load API keys."));
      const payload = (await response.json()) as { keys: ApiKeyRecord[] };
      return payload.keys;
    },
  });

  const createKey = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Enter a key name.");
      const response = await authorizedRequest("/api/tenant/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not create API key."));
      return (await response.json()) as { key: string };
    },
    onSuccess: async (payload) => {
      setNewKey(payload.key);
      setName("");
      toast.success("API key created");
      await queryClient.invalidateQueries({ queryKey: ["tenant-api-keys"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeKey = useMutation({
    mutationFn: async (keyId: string) => {
      const response = await authorizedRequest("/api/tenant/api-keys", {
        method: "DELETE",
        body: JSON.stringify({ keyId }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not revoke API key."));
    },
    onSuccess: async () => {
      toast.success("API key revoked");
      await queryClient.invalidateQueries({ queryKey: ["tenant-api-keys"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function copyKey() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      toast.success("API key copied");
    } catch {
      toast.error("Could not copy. Select and copy the key manually.");
    }
  }

  function toggleScope(scope: string) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer API"
        description="Create tenant-scoped API credentials for approved integrations and automation."
      />

      {newKey && (
        <section
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/30"
          role="alert"
        >
          <p className="font-semibold">Copy this key now</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It will not be shown again. Store it as a secret in the third-party system.
          </p>
          <div className="mt-3 flex gap-2">
            <Input readOnly value={newKey} className="font-mono" aria-label="New API key" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void copyKey()}
              aria-label="Copy API key"
            >
              <Copy />
            </Button>
          </div>
        </section>
      )}

      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 text-primary" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Create API key</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="api-key-name">Key name</Label>
                <Input
                  id="api-key-name"
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Billing integration"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="api-key-expiry">Expiry (days)</Label>
                <Input
                  id="api-key-expiry"
                  type="number"
                  min="1"
                  max="365"
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(event.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <fieldset className="mt-4">
              <legend className="text-sm font-medium">Scopes</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {["static_ips:read", "static_ips:write", "routers:read", "customers:read"].map(
                  (scope) => (
                    <label
                      key={scope}
                      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                      />
                      {scope}
                    </label>
                  ),
                )}
              </div>
            </fieldset>
            <Button
              className="mt-4"
              type="button"
              onClick={() => createKey.mutate()}
              disabled={createKey.isPending || scopes.length === 0}
            >
              <Plus />
              {createKey.isPending ? "Creating…" : "Create key"}
            </Button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b p-4">
          <h2 className="font-semibold">API keys</h2>
        </div>
        {keysQuery.isPending ? (
          <p className="p-4 text-sm text-muted-foreground" role="status">
            Loading API keys…
          </p>
        ) : keysQuery.isError ? (
          <p className="p-4 text-sm text-destructive" role="alert">
            {keysQuery.error.message}
          </p>
        ) : keysQuery.data.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No API keys have been created.</p>
        ) : (
          <div className="divide-y">
            {keysQuery.data.map((key) => (
              <div key={key.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{key.name}</p>
                    {key.revoked_at && <Badge variant="secondary">revoked</Badge>}
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {key.key_prefix}••••••••••••••••••••
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {key.scopes.join(", ")}
                    {key.expires_at
                      ? ` · expires ${new Date(key.expires_at).toLocaleDateString()}`
                      : " · no expiry"}
                  </p>
                </div>
                {!key.revoked_at && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Revoke ${key.name}`}
                    disabled={revokeKey.isPending}
                    onClick={() => revokeKey.mutate(key.id)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
