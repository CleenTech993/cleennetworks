import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tenant/pppoe")({ component: PPPoE });

function PPPoE() {
  const { data } = useQuery({
    queryKey: ["pppoe-customers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id,full_name,pppoe_username,pppoe_password,static_ip,status,expires_at")
        .eq("customer_type", "pppoe")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div>
      <PageHeader title="PPPoE" description="PPPoE secrets, profiles and active connections." />
      {!data?.length ? (
        <EmptyState title="No PPPoE subscribers" description="Add a PPPoE customer from the Customers page to provision a secret on your MikroTik." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Username</th>
                <th className="px-4 py-2">Password</th>
                <th className="px-4 py-2">Static IP</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Expires</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2">{c.full_name ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.pppoe_username ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.pppoe_password ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.static_ip ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === "active" ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
