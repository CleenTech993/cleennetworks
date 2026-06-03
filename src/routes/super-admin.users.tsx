import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/super-admin/users")({ component: Users });

type AppRole = Database["public"]["Enums"]["app_role"];
const ROLES: AppRole[] = ["super_admin", "tenant_admin", "technician", "billing_agent", "support_staff", "end_user"];

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function Users() {
  const qc = useQueryClient();
  const [approveFor, setApproveFor] = useState<{ id: string; email: string | null; full_name: string | null } | null>(null);

  const { data: profiles } = useQuery({
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

  const { data: roles } = useQuery({
    queryKey: ["all-user-roles"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("user_id,role,tenant_id");
      return data ?? [];
    },
  });

  const { data: tenants } = useQuery({
    queryKey: ["all-tenants-min"],
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("id,name,slug").order("name");
      return data ?? [];
    },
  });

  const rolesByUser = useMemo(() => {
    const m = new Map<string, { role: AppRole; tenant_id: string | null }[]>();
    (roles ?? []).forEach((r) => {
      const arr = m.get(r.user_id) ?? [];
      arr.push({ role: r.role as AppRole, tenant_id: r.tenant_id });
      m.set(r.user_id, arr);
    });
    return m;
  }, [roles]);

  return (
    <div>
      <PageHeader title="Users" description="Approve new signups and manage roles across all tenants." />
      {!profiles?.length ? (
        <EmptyState title="No users" description="Users will appear here once accounts are created." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Roles</th>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2">Joined</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((u) => {
                const userRoles = rolesByUser.get(u.id) ?? [];
                const pending = userRoles.length === 0;
                return (
                  <tr key={u.id} className="border-t">
                    <td className="px-4 py-2">{u.full_name ?? "—"}</td>
                    <td className="px-4 py-2">{u.email ?? "—"}</td>
                    <td className="px-4 py-2">
                      {pending
                        ? <Badge variant="secondary">Pending</Badge>
                        : <div className="flex flex-wrap gap-1">{userRoles.map((r) => <Badge key={r.role}>{r.role}</Badge>)}</div>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{u.tenant_id?.slice(0, 8) ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant={pending ? "default" : "outline"}
                        onClick={() => setApproveFor({ id: u.id, email: u.email, full_name: u.full_name })}
                      >
                        {pending ? "Approve" : "Assign role"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ApproveDialog
        target={approveFor}
        tenants={tenants ?? []}
        onClose={() => setApproveFor(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["all-users"] });
          qc.invalidateQueries({ queryKey: ["all-user-roles"] });
          qc.invalidateQueries({ queryKey: ["all-tenants-min"] });
          qc.invalidateQueries({ queryKey: ["all-tenants"] });
          setApproveFor(null);
        }}
      />
    </div>
  );
}

function ApproveDialog({
  target, tenants, onClose, onDone,
}: {
  target: { id: string; email: string | null; full_name: string | null } | null;
  tenants: { id: string; name: string; slug: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [role, setRole] = useState<AppRole>("tenant_admin");
  const [tenantId, setTenantId] = useState<string>("__new__");
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [loading, setLoading] = useState(false);

  const isSuper = role === "super_admin";
  const creatingNew = !isSuper && tenantId === "__new__";

  async function submit() {
    if (!target) return;
    setLoading(true);
    try {
      const args: Record<string, unknown> = {
        p_user_id: target.id,
        p_role: role,
        p_tenant_id: null as string | null,
        p_new_tenant_name: null as string | null,
        p_new_tenant_slug: null as string | null,
      };
      if (!isSuper) {
        if (creatingNew) {
          if (!newName.trim()) throw new Error("Tenant name required");
          const slug = newSlug.trim() || `${slugify(newName)}-${Math.random().toString(36).slice(2, 6)}`;
          args.p_new_tenant_name = newName.trim();
          args.p_new_tenant_slug = slug;
        } else {
          args.p_tenant_id = tenantId;
        }
      }
      const { error } = await supabase.rpc("admin_approve_user", args as never);
      if (error) throw error;
      toast.success("User approved");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve user</DialogTitle>
          <DialogDescription>
            {target?.full_name ?? target?.email ?? "Assign a role and tenant for this account."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {!isSuper && (
            <div>
              <Label>Tenant</Label>
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__new__">+ Create new tenant</SelectItem>
                  {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.slug})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {creatingNew && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="tname">Tenant name</Label>
                <Input id="tname" value={newName} onChange={(e) => { setNewName(e.target.value); if (!newSlug) setNewSlug(slugify(e.target.value)); }} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="tslug">Slug</Label>
                <Input id="tslug" value={newSlug} onChange={(e) => setNewSlug(slugify(e.target.value))} placeholder="acme-wifi" className="mt-1" />
              </div>
            </div>
          )}

          {isSuper && (
            <p className="text-xs text-muted-foreground">Super admins are not attached to any tenant.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Approving…" : "Approve"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
