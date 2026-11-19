import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Globe2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { normalizeCustomDomain } from "@/lib/tenant-customization";

type DomainPurpose = "hotspot" | "console";
type TenantDomain = Pick<
  Tables<"tenant_domains">,
  "id" | "domain" | "purpose" | "verification_token" | "verified_at"
>;
const canonicalHost = (import.meta.env.VITE_APP_CANONICAL_HOST ?? "").trim().toLowerCase();

export function TenantDomainSettings() {
  const { tenantId } = useAuth();
  const queryClient = useQueryClient();
  const [purpose, setPurpose] = useState<DomainPurpose>("hotspot");
  const [domainInput, setDomainInput] = useState("");

  const domainsQuery = useQuery({
    queryKey: ["tenant-domains", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_domains")
        .select("id,domain,purpose,verification_token,verified_at")
        .eq("tenant_id", tenantId!)
        .order("created_at");
      if (error) throw error;
      return data as TenantDomain[];
    },
  });
  useEffect(() => {
    const savedDomain = domainsQuery.data?.find((item) => item.purpose === purpose)?.domain;
    if (savedDomain) setDomainInput(savedDomain);
  }, [domainsQuery.data, purpose]);

  const saveDomain = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Tenant account is not available.");
      const domain = normalizeCustomDomain(domainInput);
      if (!domain) throw new Error("Enter a valid subdomain, for example wifi.example.com.");
      const existing = domainsQuery.data?.find((item) => item.purpose === purpose);
      if (existing) {
        const { error } = await supabase
          .from("tenant_domains")
          .update({ domain })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("tenant_domains")
          .insert({ tenant_id: tenantId, purpose, domain });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      setDomainInput("");
      await queryClient.invalidateQueries({ queryKey: ["tenant-domains", tenantId] });
      toast.success("Domain saved. Add the DNS records below to verify ownership.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const verifyDomain = useMutation({
    mutationFn: async (domainId: string) => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in again before verifying your domain.");
      const response = await fetch("/api/tenant/domains/verify", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ domainId }),
      });
      const result = (await response.json()) as { error?: string; verified?: boolean };
      if (!response.ok) throw new Error(result.error ?? "Could not verify DNS records.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tenant-domains", tenantId] });
      toast.success("Domain ownership and CNAME verified.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeDomain = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tenant_domains").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenant-domains", tenantId] }),
    onError: (error: Error) => toast.error(error.message),
  });

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch (error) {
      console.error("Could not copy domain setup value", error);
      toast.error("Could not copy. Select and copy the value manually.");
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5 md:col-span-2">
      <div className="flex items-start gap-3">
        <Globe2 className="mt-1 h-5 w-5 text-primary" />
        <div>
          <h3 className="font-semibold">Custom domains</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Use a domain you own for your hotspot portal or tenant console. Choose a subdomain such
            as <code>wifi.example.com</code>; your reverse proxy must route it to this app and serve
            a valid HTTPS certificate. Keep the CNAME DNS-only during verification; DNS proxying or
            flattening may hide the CNAME record.
          </p>
        </div>
      </div>
      {!canonicalHost && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
        >
          Custom-domain verification is not configured. Set <code>APP_CANONICAL_HOST</code> on the
          server and <code>VITE_APP_CANONICAL_HOST</code> at build time to your app’s canonical
          hostname.
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <div>
          <Label htmlFor="domain-purpose">Domain use</Label>
          <select
            id="domain-purpose"
            className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={purpose}
            onChange={(event) => {
              const nextPurpose = event.target.value;
              if (nextPurpose !== "hotspot" && nextPurpose !== "console") return;
              setPurpose(nextPurpose);
              setDomainInput(
                domainsQuery.data?.find((item) => item.purpose === nextPurpose)?.domain ?? "",
              );
            }}
          >
            <option value="hotspot">Hotspot portal</option>
            <option value="console">Tenant admin panel</option>
          </select>
        </div>
        <div>
          <Label htmlFor="custom-domain">Your subdomain</Label>
          <Input
            id="custom-domain"
            value={domainInput}
            onChange={(event) => setDomainInput(event.target.value)}
            placeholder="wifi.example.com"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
        <Button
          onClick={() => saveDomain.mutate()}
          disabled={!tenantId || saveDomain.isPending || !canonicalHost}
        >
          {saveDomain.isPending ? "Saving…" : "Save domain"}
        </Button>
      </div>
      {domainsQuery.error instanceof Error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Could not load domains: {domainsQuery.error.message}
        </p>
      )}
      <div className="mt-5 space-y-4">
        {(domainsQuery.data ?? []).map((domain) => {
          const txtName = `_netgrid-verify.${domain.domain}`;
          return (
            <div key={domain.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {domain.purpose === "hotspot" ? "Hotspot portal" : "Tenant admin panel"}:{" "}
                    <code>{domain.domain}</code>
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    {domain.verified_at ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        DNS ownership verified
                      </>
                    ) : (
                      "Waiting for DNS verification"
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!domain.verified_at && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => verifyDomain.mutate(domain.id)}
                      disabled={verifyDomain.isPending || !canonicalHost}
                    >
                      {verifyDomain.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )}
                      Verify DNS
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeDomain.mutate(domain.id)}
                    disabled={removeDomain.isPending}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              {!domain.verified_at && (
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                  <div className="rounded-md bg-muted p-3">
                    <p className="text-xs font-medium text-muted-foreground">CNAME record</p>
                    <p className="mt-1 break-all">
                      Name: <code>{domain.domain}</code>
                    </p>
                    <p className="break-all">
                      Target: <code>{canonicalHost || "Set APP_CANONICAL_HOST"}</code>
                    </p>
                    {canonicalHost && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="mt-1 h-7 px-2"
                        onClick={() => void copy(canonicalHost)}
                      >
                        <Copy className="h-3 w-3" /> Copy target
                      </Button>
                    )}
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      TXT verification record
                    </p>
                    <p className="mt-1 break-all">
                      Name: <code>{txtName}</code>
                    </p>
                    <p className="break-all">
                      Value: <code>{domain.verification_token}</code>
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="mt-1 h-7 px-2"
                      onClick={() => void copy(domain.verification_token)}
                    >
                      <Copy className="h-3 w-3" /> Copy token
                    </Button>
                  </div>
                </div>
              )}
              {domain.verified_at && (
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>
                    DNS ownership and CNAME are verified. The domain only becomes reachable after
                    your reverse proxy is configured to accept this hostname and serve HTTPS.
                  </p>
                  {domain.purpose === "console" && (
                    <p>
                      Allow <code>https://{domain.domain}/**</code> in Supabase Auth redirect URLs.
                    </p>
                  )}
                  <a
                    href={`https://${domain.domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-primary underline"
                  >
                    Open {domain.domain}
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
