import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/super-admin/users")({ component: Users });

function Users() {
  const { data } = useQuery({
    queryKey: ["all-users"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,email,full_name,tenant_id,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      return data ?? [];
    },
  });

  return (
    <div>
      <PageHeader title="Users" description="Global user directory across all tenants." />
      {!data?.length ? (
        <EmptyState title="No users" description="Users will appear here once accounts are created." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-2">{u.full_name ?? "—"}</td>
                  <td className="px-4 py-2">{u.email ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{u.tenant_id?.slice(0, 8) ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
