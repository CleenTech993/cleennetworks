import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/portal/usage")({ component: Usage });

function Usage() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["portal-usage", user?.email],
    enabled: !!user?.email,
    queryFn: async () => {
      const { data: customer } = await supabase.from("customers").select("id").eq("email", user!.email!).maybeSingle();
      if (!customer) return [];
      const { data } = await supabase
        .from("sessions")
        .select("id,started_at,ended_at,bytes_in,bytes_out,status,mac_address")
        .eq("customer_id", customer.id)
        .order("started_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const fmt = (b: number | null) => (b ? (b / 1024 / 1024).toFixed(1) + " MB" : "—");

  return (
    <div>
      <PageHeader title="Usage" description="Your session history and data consumed." />
      {!data?.length ? (
        <EmptyState title="No sessions yet" description="Connect to the network to start your first session." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
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
              {data.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-2 text-muted-foreground">{new Date(s.started_at).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">{s.mac_address ?? "—"}</td>
                  <td className="px-4 py-2">{fmt(s.bytes_in)}</td>
                  <td className="px-4 py-2">{fmt(s.bytes_out)}</td>
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
