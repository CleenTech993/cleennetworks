import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Cpu, HeartPulse, RefreshCw, ShieldCheck, Stethoscope } from "lucide-react";
import { PageHeader } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  diagnoseNetwork,
  networkDoctorDeterministicSummary,
  type NetworkDoctorFinding,
  type NetworkDoctorRouter,
} from "@/lib/network-diagnostics";

export const Route = createFileRoute("/tenant/network-doctor")({
  component: NetworkDoctorPage,
});

type DoctorResponse = {
  summary: string;
  findings: NetworkDoctorFinding[];
  provider: "openai" | "deterministic";
};

function severityVariant(severity: NetworkDoctorFinding["severity"]) {
  if (severity === "critical") return "destructive" as const;
  if (severity === "warning") return "secondary" as const;
  return "outline" as const;
}

function NetworkDoctorPage() {
  const { tenantId } = useAuth();
  const routerQuery = useQuery({
    queryKey: ["network-doctor-routers", tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routers")
        .select(
          "id,name,status,last_heartbeat_at,last_seen_at,cpu_load,cpu_usage,ram_usage,total_memory_mb,free_memory_mb,temperature,uptime_seconds,parent_router_id",
        )
        .eq("tenant_id", tenantId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as NetworkDoctorRouter[];
    },
  });

  const findings = diagnoseNetwork(routerQuery.data ?? []);
  const deterministicSummary = networkDoctorDeterministicSummary(findings);

  const doctorMutation = useMutation({
    mutationFn: async (): Promise<DoctorResponse> => {
      if (!tenantId) throw new Error("Tenant account is not available.");
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sign in again before running Network Doctor.");

      const response = await fetch("/api/tenant/network-doctor", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ tenantId, findings }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Could not run Network Doctor.";
        throw new Error(message);
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("summary" in payload) ||
        typeof payload.summary !== "string" ||
        !("provider" in payload) ||
        (payload.provider !== "openai" && payload.provider !== "deterministic") ||
        !("findings" in payload) ||
        !Array.isArray(payload.findings)
      ) {
        throw new Error("Network Doctor returned an invalid response.");
      }
      return payload as unknown as DoctorResponse;
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Network Doctor"
        description="Fleet-level diagnosis using recent heartbeats and router health evidence."
      />

      {routerQuery.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading fleet diagnostics…
        </p>
      ) : routerQuery.isError ? (
        <section className="rounded-xl border border-destructive/30 bg-card p-4" role="alert">
          <p className="font-medium">Fleet diagnostics could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">{routerQuery.error.message}</p>
          <Button className="mt-3" variant="outline" onClick={() => void routerQuery.refetch()}>
            Try again
          </Button>
        </section>
      ) : (
        <>
          <section className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Stethoscope className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="font-semibold">Network diagnosis</h2>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    {doctorMutation.data?.summary ?? deterministicSummary}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                onClick={() => doctorMutation.mutate()}
                disabled={doctorMutation.isPending}
              >
                {doctorMutation.isPending ? (
                  <RefreshCw className="animate-spin" aria-hidden="true" />
                ) : (
                  <HeartPulse aria-hidden="true" />
                )}
                {doctorMutation.isPending ? "Diagnosing…" : "Run AI diagnosis"}
              </Button>
            </div>
            {doctorMutation.data && (
              <p className="mt-3 text-xs text-muted-foreground">
                Summary source:{" "}
                {doctorMutation.data.provider === "openai"
                  ? "OpenAI, with deterministic evidence"
                  : "Deterministic rules"}
              </p>
            )}
            {doctorMutation.isError && (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {doctorMutation.error.message}
              </p>
            )}
          </section>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Enrolled routers
              </div>
              <p className="mt-2 text-2xl font-semibold">{routerQuery.data?.length ?? 0}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Cpu className="h-4 w-4" aria-hidden="true" />
                Findings
              </div>
              <p className="mt-2 text-2xl font-semibold">{findings.length}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Critical
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {findings.filter((finding) => finding.severity === "critical").length}
              </p>
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b p-4">
              <h2 className="font-semibold">Evidence and recommended checks</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Findings are diagnostic prompts, not automatic remediation instructions.
              </p>
            </div>
            {findings.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No findings detected.</p>
            ) : (
              <div className="divide-y">
                {(doctorMutation.data?.findings ?? findings).map((finding, index) => (
                  <article key={`${finding.category}-${finding.title}-${index}`} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="font-medium">{finding.title}</h3>
                      <Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{finding.evidence}</p>
                    <p className="mt-2 text-sm">
                      <span className="font-medium">Recommended check:</span>{" "}
                      {finding.recommendation}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
