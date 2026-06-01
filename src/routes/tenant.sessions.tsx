import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tenant/sessions")({ component: Sessions });

function Sessions() {
  const { data } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id,mac_address,ip_address,status,started_at,ended_at,bytes_in,bytes_out")
        .order("started_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const fmtMB = (b: number | null) => (b ? (b / 1024 / 1024).toFixed(1) + " MB" : "—");

  return (
    <div>
      <PageHeader title="Sessions" description="Live and historical user sessions across all routers." />
      {!data?.length ? (
        <EmptyState title="No sessions yet" description="Sessions will appear here once routers start reporting." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">MAC</th>
                <th className="px-4 py-2">IP</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2">Download</th>
                <th className="px-4 py-2">Upload</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">{s.mac_address ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{s.ip_address ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${s.status === "active" ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{new Date(s.started_at).toLocaleString()}</td>
                  <td className="px-4 py-2">{fmtMB(s.bytes_in)}</td>
                  <td className="px-4 py-2">{fmtMB(s.bytes_out)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
