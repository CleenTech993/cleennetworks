import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  buildFleetSlaCsv,
  calculateFleetSla,
  type FleetSlaOutage,
  type FleetSlaRouter,
} from "@/lib/router-fleet-sla";

const RANGE_MS = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;
type Range = keyof typeof RANGE_MS;
const SLA_TARGET = 99.5;

export function RouterFleetSlaCard({
  tenantId,
  routers,
}: {
  tenantId: string | null;
  routers: FleetSlaRouter[];
}) {
  const [range, setRange] = useState<Range>("7d");
  const {
    data: outages = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["router-fleet-sla-outages", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      if (!tenantId) throw new Error("Tenant context is unavailable.");
      const pageSize = 1000;
      const allOutages: FleetSlaOutage[] = [];
      const since = new Date(Date.now() - RANGE_MS["30d"]).toISOString();
      for (let offset = 0; ; offset += pageSize) {
        const { data, error: queryError } = await supabase
          .from("router_uptime_events")
          .select("router_id,started_at,ended_at")
          .eq("tenant_id", tenantId)
          .gte("started_at", since)
          .order("started_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (queryError) throw queryError;
        allOutages.push(...(data ?? []));
        if (!data || data.length < pageSize) return allOutages;
      }
    },
    refetchInterval: 60_000,
  });

  const now = Date.now();
  const results = useMemo(
    () => calculateFleetSla({ routers, outages, windowMs: RANGE_MS[range], now }),
    [routers, outages, range, now],
  );
  const measured = results.filter((result) => result.uptimePercent != null);
  const average = measured.length
    ? measured.reduce((sum, result) => sum + (result.uptimePercent ?? 0), 0) / measured.length
    : null;
  const meetingSla = measured.filter((result) => (result.uptimePercent ?? 0) >= SLA_TARGET).length;
  const belowSla = measured.length - meetingSla;
  const unavailable = results.length - measured.length;

  function exportReport() {
    const csv = buildFleetSlaCsv(results, range, new Date().toISOString());
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `fleet-sla-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <section className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Fleet SLA report
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Uptime from router outage history and last heartbeat; target {SLA_TARGET}%.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Fleet SLA reporting period"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={range}
            onChange={(event) => setRange(event.target.value as Range)}
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={exportReport}
            disabled={isLoading || !!error || results.length === 0}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {!tenantId ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Tenant context is unavailable; fleet SLA data cannot be loaded.
        </p>
      ) : error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          Could not load router outage history: {error.message}
        </p>
      ) : isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading fleet reliability…</p>
      ) : routers.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Add a router to start tracking fleet SLA.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Average measured uptime</p>
              <p className="mt-1 text-xl font-semibold">
                {average == null ? "—" : `${average.toFixed(2)}%`}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Meeting SLA</p>
              <p className="mt-1 text-xl font-semibold">{meetingSla}</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Below SLA</p>
              <p className="mt-1 text-xl font-semibold">{belowSla}</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Insufficient telemetry</p>
              <p className="mt-1 text-xl font-semibold">{unavailable}</p>
            </div>
          </div>

          <div className="mt-4 max-h-72 overflow-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Router</th>
                  <th className="px-3 py-2">Uptime</th>
                  <th className="px-3 py-2">Outages</th>
                  <th className="px-3 py-2">SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {results.map((result) => {
                  const meetsTarget =
                    result.uptimePercent != null && result.uptimePercent >= SLA_TARGET;
                  return (
                    <tr key={result.routerId}>
                      <td className="px-3 py-2">
                        <Link
                          to="/tenant/routers/$id"
                          params={{ id: result.routerId }}
                          className="font-medium text-primary hover:underline"
                        >
                          {result.routerName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {result.uptimePercent == null
                          ? "Insufficient telemetry"
                          : `${result.uptimePercent.toFixed(2)}%`}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{result.outageCount}</td>
                      <td className="px-3 py-2">
                        {result.uptimePercent == null
                          ? "Unavailable"
                          : meetsTarget
                            ? "Met"
                            : "Below target"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
