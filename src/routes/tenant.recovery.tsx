import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Power, RefreshCw } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  applyHotspotOutageRecovery,
  previewHotspotOutageRecovery,
} from "@/lib/hotspot-recovery.functions";

type RecoveryCandidate = Awaited<ReturnType<typeof previewHotspotOutageRecovery>>[number];

export const Route = createFileRoute("/tenant/recovery")({ component: HotspotRecoveryPage });

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function HotspotRecoveryPage() {
  const { tenantId } = useAuth();
  const queryClient = useQueryClient();
  const [routerId, setRouterId] = useState("");
  const [detectedOutageId, setDetectedOutageId] = useState("");
  const [outageStartedAt, setOutageStartedAt] = useState("");
  const [outageEndedAt, setOutageEndedAt] = useState("");
  const [manual, setManual] = useState(false);
  const [reason, setReason] = useState("");
  const [candidates, setCandidates] = useState<RecoveryCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const routersQuery = useQuery({
    queryKey: ["hotspot-recovery-routers", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.from("routers").select("id,name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const outagesQuery = useQuery({
    queryKey: ["hotspot-recovery-outages", routerId],
    enabled: Boolean(routerId),
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("router_uptime_events")
        .select("id,started_at,ended_at")
        .eq("router_id", routerId)
        .eq("kind", "down")
        .not("ended_at", "is", null)
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data;
    },
  });

  function formData() {
    if (!tenantId) throw new Error("Your organization could not be determined.");
    if (!routerId || !outageStartedAt || !outageEndedAt)
      throw new Error("Choose a router and enter the outage start and end times.");
    if (reason.trim().length < 3) throw new Error("Enter a short reason for the recovery record.");
    const start = new Date(outageStartedAt);
    const end = new Date(outageEndedAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
      throw new Error("Enter valid outage times.");
    return {
      tenantId,
      routerId,
      outageStartedAt: start.toISOString(),
      outageEndedAt: end.toISOString(),
      mode: manual ? ("manual" as const) : ("tracked" as const),
      reason: reason.trim(),
    };
  }

  const preview = useMutation({
    mutationFn: () => previewHotspotOutageRecovery({ data: formData() }),
    onSuccess: (rows) => {
      setCandidates(rows);
      setSelectedIds(new Set(rows.map((row) => row.paymentId)));
      if (!rows.length) toast.info("No eligible paid hotspot sessions were found.");
    },
    onError: (error) => toast.error(error.message),
  });

  function clearPreview() {
    setCandidates([]);
    setSelectedIds(new Set());
    preview.reset();
  }

  const apply = useMutation({
    mutationFn: () =>
      applyHotspotOutageRecovery({
        data: { ...formData(), paymentIds: [...selectedIds] },
      }),
    onSuccess: async (result) => {
      toast.success(`Access restored for ${result.recoveredCount} customer(s).`);
      setCandidates([]);
      setSelectedIds(new Set());
      preview.reset();
      await queryClient.invalidateQueries({ queryKey: ["tenant-payments"] });
    },
    onError: (error) => toast.error(error.message),
  });

  function toggleSelected(paymentId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(paymentId)) next.delete(paymentId);
      else next.add(paymentId);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hotspot outage recovery"
        description="Review paid hotspot access affected by a router outage and safely restore eligible package time."
      />

      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <Power className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="font-semibold">Record an outage</h2>
            <p className="text-sm text-muted-foreground">
              Tracked recovery includes paid sessions active just before the outage and unused
              purchases tied to this router. A customer qualifies only when at least half of the
              package time remained. Select a detected router outage to fill its recorded times, or
              enter times manually.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="recovery-router">Affected router</Label>
            <select
              id="recovery-router"
              value={routerId}
              onChange={(event) => {
                setRouterId(event.target.value);
                setDetectedOutageId("");
                clearPreview();
              }}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              disabled={routersQuery.isLoading}
            >
              <option value="">Select a router</option>
              {(routersQuery.data ?? []).map((router) => (
                <option key={router.id} value={router.id}>
                  {router.name}
                </option>
              ))}
            </select>
            {routersQuery.isError && (
              <p className="text-sm text-destructive">Could not load routers.</p>
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="recovery-detected-outage">Detected router outage (optional)</Label>
            <select
              id="recovery-detected-outage"
              value={detectedOutageId}
              onChange={(event) => {
                const outageId = event.target.value;
                const outage = (outagesQuery.data ?? []).find((row) => row.id === outageId);
                setDetectedOutageId(outageId);
                if (outage?.ended_at) {
                  setOutageStartedAt(toDateTimeLocal(outage.started_at));
                  setOutageEndedAt(toDateTimeLocal(outage.ended_at));
                }
                clearPreview();
              }}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              disabled={!routerId || outagesQuery.isLoading}
            >
              <option value="">
                {outagesQuery.isLoading
                  ? "Loading detected outages..."
                  : "Select a detected outage"}
              </option>
              {(outagesQuery.data ?? []).map((outage) => (
                <option key={outage.id} value={outage.id}>
                  {new Date(outage.started_at).toLocaleString()} —{" "}
                  {outage.ended_at ? new Date(outage.ended_at).toLocaleString() : "ongoing"}
                </option>
              ))}
            </select>
            {outagesQuery.isError && (
              <p className="text-sm text-destructive">Could not load detected outages.</p>
            )}
            {outagesQuery.isSuccess && outagesQuery.data.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No detected router outages in the past 30 days. You can enter the times manually.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="recovery-start">Outage started</Label>
            <Input
              id="recovery-start"
              type="datetime-local"
              value={outageStartedAt}
              onChange={(event) => {
                setDetectedOutageId("");
                setOutageStartedAt(event.target.value);
                clearPreview();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recovery-end">Service restored</Label>
            <Input
              id="recovery-end"
              type="datetime-local"
              value={outageEndedAt}
              onChange={(event) => {
                setDetectedOutageId("");
                setOutageEndedAt(event.target.value);
                clearPreview();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recovery-reason">Reason / incident reference</Label>
            <Input
              id="recovery-reason"
              value={reason}
              maxLength={500}
              placeholder="e.g. Power outage at site"
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={manual}
            onChange={(event) => {
              setManual(event.target.checked);
              clearPreview();
            }}
          />
          <span>
            <span className="block text-sm font-medium">Manual recovery for an older outage</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Historical connected-time data may not exist. Unmeasured sessions will be labelled as
              estimates and require your review before restoring access.
            </span>
          </span>
        </label>

        {manual && (
          <div className="mt-4 flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <p>
              Manual recovery may include customers whose actual network usage cannot be verified.
              Review the selected payments before applying.
            </p>
          </div>
        )}

        <Button
          className="mt-5"
          disabled={preview.isPending || apply.isPending || !routersQuery.data?.length}
          onClick={() => preview.mutate()}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${preview.isPending ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Preview eligible customers
        </Button>
      </div>

      {candidates.length > 0 ? (
        <section className="rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div>
              <h2 className="font-semibold">Recovery preview</h2>
              <p className="text-sm text-muted-foreground">
                {selectedIds.size} of {candidates.length} customer(s) selected
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setSelectedIds(
                    selectedIds.size === candidates.length
                      ? new Set()
                      : new Set(candidates.map((candidate) => candidate.paymentId)),
                  )
                }
              >
                {selectedIds.size === candidates.length ? "Clear selection" : "Select all"}
              </Button>
              <Button
                disabled={!selectedIds.size || apply.isPending}
                onClick={() => apply.mutate()}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Restore selected access
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-12 p-3">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Package</th>
                  <th className="p-3">Time used</th>
                  <th className="p-3">Time restored</th>
                  <th className="p-3">Payment code</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.paymentId} className="border-t">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(candidate.paymentId)}
                        onChange={() => toggleSelected(candidate.paymentId)}
                        aria-label={`Select payment ending ${candidate.receiptSuffix}`}
                      />
                    </td>
                    <td className="whitespace-nowrap p-3">{candidate.phone}</td>
                    <td className="p-3">
                      <span>{candidate.packageName}</span>
                      {candidate.estimated && (
                        <Badge variant="outline" className="ml-2">
                          Estimate
                        </Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {candidate.estimated
                        ? "Not recorded"
                        : formatDuration(candidate.connectedSeconds)}
                    </td>
                    <td className="whitespace-nowrap p-3 font-medium">
                      {formatDuration(candidate.restoredSeconds)}
                    </td>
                    <td className="p-3 font-mono">•••• {candidate.receiptSuffix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t p-4 text-xs text-muted-foreground">
            Applying recovery restores the remaining package duration from now. A payment cannot be
            recovered twice for an overlapping incident; separate outages use the time still
            remaining on that paid session.
          </p>
        </section>
      ) : preview.isSuccess ? (
        <EmptyState
          title="No eligible paid sessions"
          description="No matching hotspot payments met the recovery rules for this router and outage window."
        />
      ) : null}
    </div>
  );
}
