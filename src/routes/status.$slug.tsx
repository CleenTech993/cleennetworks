import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicNetworkStatus } from "@/lib/public-network-status";

type StatusResponse = {
  name: string;
  status: PublicNetworkStatus;
  updatedAt: string;
};

const statusCopy: Record<
  PublicNetworkStatus,
  { title: string; detail: string; Icon: typeof Activity }
> = {
  operational: {
    title: "All systems operational",
    detail: "The network is reporting normally.",
    Icon: CheckCircle2,
  },
  degraded: {
    title: "Some network disruption",
    detail: "Part of the network is currently unreachable. We are monitoring service.",
    Icon: AlertTriangle,
  },
  outage: {
    title: "Network outage",
    detail: "Our network is currently unreachable. We are working to restore service.",
    Icon: WifiOff,
  },
  unknown: {
    title: "Status not yet available",
    detail: "There is not enough recent network data to report service health.",
    Icon: CircleHelp,
  },
};

function parseStatusResponse(payload: unknown): StatusResponse | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("name" in payload) ||
    typeof payload.name !== "string" ||
    !("status" in payload) ||
    !("updatedAt" in payload) ||
    typeof payload.updatedAt !== "string"
  ) {
    return null;
  }

  const status = payload.status;
  if (
    status !== "operational" &&
    status !== "degraded" &&
    status !== "outage" &&
    status !== "unknown"
  ) {
    return null;
  }
  return { name: payload.name, status, updatedAt: payload.updatedAt };
}

export const Route = createFileRoute("/status/$slug")({
  head: () => ({
    meta: [
      { title: "Network status" },
      { name: "description", content: "Check current network service status." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PublicStatusPage,
});

function PublicStatusPage() {
  const { slug } = Route.useParams();
  const query = useQuery({
    queryKey: ["public-network-status", slug],
    refetchInterval: 60_000,
    queryFn: async () => {
      const response = await fetch(`/api/public/status/${encodeURIComponent(slug)}`, {
        headers: { Accept: "application/json" },
      });
      if (response.status === 404) throw new Error("This public status page is not available.");
      if (!response.ok) throw new Error("Network status is temporarily unavailable.");
      const payload = parseStatusResponse(await response.json());
      if (!payload) throw new Error("The status response was invalid.");
      return payload;
    },
  });

  const summary = statusCopy[query.data?.status ?? "unknown"];
  const StatusIcon = summary.Icon;

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Activity aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Network status
            </p>
            <h1 className="text-xl font-semibold">{query.data?.name ?? "Service status"}</h1>
          </div>
        </header>

        {query.isPending ? (
          <section className="rounded-2xl border bg-card p-6" role="status">
            <p className="text-sm text-muted-foreground">Checking current network status…</p>
          </section>
        ) : query.isError ? (
          <section className="rounded-2xl border border-destructive/30 bg-card p-6" role="alert">
            <h2 className="font-semibold">Status unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">{query.error.message}</p>
            <Button className="mt-4" variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          </section>
        ) : (
          <section className="rounded-2xl border bg-card p-6 shadow-sm" aria-live="polite">
            <div className="flex items-start gap-4">
              <StatusIcon
                aria-hidden="true"
                className={`mt-0.5 h-7 w-7 shrink-0 ${
                  query.data.status === "operational"
                    ? "text-emerald-600"
                    : query.data.status === "unknown"
                      ? "text-muted-foreground"
                      : "text-amber-600"
                }`}
              />
              <div>
                <h2 className="text-lg font-semibold">{summary.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{summary.detail}</p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground">
              <p>
                Last checked{" "}
                <time dateTime={query.data.updatedAt}>
                  {new Date(query.data.updatedAt).toLocaleString()}
                </time>
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void query.refetch()}
                disabled={query.isFetching}
              >
                <RefreshCw aria-hidden="true" className={query.isFetching ? "animate-spin" : ""} />
                Refresh
              </Button>
            </div>
          </section>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Status is based on recent check-ins from network equipment and may take a few minutes to
          reflect a change.
        </p>
      </div>
    </main>
  );
}
