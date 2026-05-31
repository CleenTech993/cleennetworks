import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/super-admin/tenants")({ component: Tenants });
function Tenants() {
  const { data, isLoading } = useQuery({
    queryKey: ["all-tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  return (
    <div>
      <PageHeader title="Tenants" description="All ISPs on the platform." />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : !data?.length ? <EmptyState title="No tenants" description="No tenants have signed up yet." />
        : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr><th className="px-4 py-2.5 text-left">Name</th><th className="px-4 py-2.5 text-left">Slug</th><th className="px-4 py-2.5 text-left">Created</th><th className="px-4 py-2.5 text-left">Status</th></tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="px-4 py-2.5 font-medium">{t.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{t.slug}</td>
                    <td className="px-4 py-2.5">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5"><Badge>{t.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
