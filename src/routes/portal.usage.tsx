import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/portal/usage")({ component: Usage });

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function Usage() {
  const { user } = useAuth();
  const usageQuery = useQuery({
    queryKey: ["portal-usage", user?.email],
    enabled: !!user?.email,
    queryFn: async () => {
      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .select("id,package_id,data_used_bytes")
        .eq("email", user!.email!)
        .maybeSingle();
      if (customerError) throw customerError;
      if (!customer) return null;

      const [sessionsResult, packageResult] = await Promise.all([
        supabase
          .from("sessions")
          .select("id,started_at,ended_at,bytes_in,bytes_out,status,mac_address")
          .eq("customer_id", customer.id)
          .order("started_at", { ascending: false })
          .limit(50),
        customer.package_id
          ? supabase
              .from("packages")
              .select("name,data_limit_mb,unlimited")
              .eq("id", customer.package_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (sessionsResult.error) throw sessionsResult.error;
      if (packageResult.error) throw packageResult.error;
      return {
        customer,
        sessions: sessionsResult.data ?? [],
        pkg: packageResult.data,
      };
    },
  });

  if (usageQuery.isPending) {
    return (
      <div>
        <PageHeader title="Usage" description="Your data usage and recent sessions." />
        <p className="text-sm text-muted-foreground" role="status">
          Loading your usage…
        </p>
      </div>
    );
  }

  if (usageQuery.isError) {
    return (
      <div>
        <PageHeader title="Usage" description="Your data usage and recent sessions." />
        <div className="rounded-xl border border-destructive/30 bg-card p-4">
          <p className="font-medium">Usage is temporarily unavailable.</p>
          <p className="mt-1 text-sm text-muted-foreground">{usageQuery.error.message}</p>
          <button
            type="button"
            className="mt-3 text-sm font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => void usageQuery.refetch()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const data = usageQuery.data;
  if (!data) {
    return (
      <div>
        <PageHeader title="Usage" description="Your data usage and recent sessions." />
        <EmptyState
          title="No subscription found"
          description="We couldn't find a subscription under your email."
        />
      </div>
    );
  }

  const usedBytes = Number(data.customer.data_used_bytes ?? 0);
  const limitBytes =
    data.pkg?.data_limit_mb && !data.pkg.unlimited
      ? Number(data.pkg.data_limit_mb) * 1024 * 1024
      : null;
  const usagePercent =
    limitBytes && Number.isFinite(limitBytes) && limitBytes > 0
      ? Math.min((usedBytes / limitBytes) * 100, 100)
      : null;

  return (
    <div>
      <PageHeader title="Usage" description="Your data usage and recent sessions." />
      {limitBytes && usagePercent !== null && (
        <section className="mb-6 rounded-xl border bg-card p-5" aria-labelledby="plan-usage-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="plan-usage-title" className="font-semibold">
                {data.pkg?.name ?? "Current plan"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Data used this plan period</p>
            </div>
            <p className="text-sm font-medium">
              {formatBytes(usedBytes)} <span className="text-muted-foreground">of</span>{" "}
              {formatBytes(limitBytes)}
            </p>
          </div>
          <Progress
            value={usagePercent}
            className="mt-4 h-2"
            aria-label={`${Math.round(usagePercent)}% of plan data used`}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {formatBytes(Math.max(limitBytes - usedBytes, 0))} remaining
          </p>
        </section>
      )}
      <h2 className="mb-3 text-lg font-semibold">Recent sessions</h2>
      {!data.sessions.length ? (
        <EmptyState
          title="No sessions yet"
          description="Connect to the network to see your recent internet sessions here."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2">Device</th>
                <th className="px-4 py-2">Download</th>
                <th className="px-4 py-2">Upload</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(s.started_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{s.mac_address ?? "—"}</td>
                  <td className="px-4 py-2">
                    {s.bytes_in == null ? "—" : formatBytes(s.bytes_in)}
                  </td>
                  <td className="px-4 py-2">
                    {s.bytes_out == null ? "—" : formatBytes(s.bytes_out)}
                  </td>
                  <td className="px-4 py-2">{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
