import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { PageHeader, EmptyState, StatCard } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Building2,
  Router as RouterIcon,
  ShieldAlert,
  ShieldCheck,
  Settings,
  ArrowUpRight,
  CreditCard,
  Sliders,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/super-admin/tenants")({ component: Tenants });

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

type TenantRow = Tables<"tenants">;

function Tenants() {
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Create form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("active");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["all-tenants-super"],
    queryFn: async () => {
      const [tenantsRes, routersRes, paymentsRes] = await Promise.all([
        supabase.from("tenants").select("*").order("created_at", { ascending: false }),
        supabase.from("routers").select("id,tenant_id,status"),
        supabase.from("payments").select("tenant_id,amount").eq("status", "success"),
      ]);

      if (tenantsRes.error) throw tenantsRes.error;

      // Group routers by tenant
      const rMap = new Map<string, number>();
      for (const r of routersRes.data ?? []) {
        rMap.set(r.tenant_id, (rMap.get(r.tenant_id) ?? 0) + 1);
      }

      // Group payments by tenant
      const pMap = new Map<string, number>();
      for (const p of paymentsRes.data ?? []) {
        pMap.set(p.tenant_id, (pMap.get(p.tenant_id) ?? 0) + Number(p.amount));
      }

      return (tenantsRes.data ?? []).map((t) => ({
        ...t,
        routerCount: rMap.get(t.id) ?? 0,
        gmv: pMap.get(t.id) ?? 0,
      }));
    },
  });

  const tenants = data ?? [];

  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(q);
        const matchesSlug = t.slug.toLowerCase().includes(q);
        const matchesEmail = t.support_email?.toLowerCase().includes(q);
        if (!matchesName && !matchesSlug && !matchesEmail) return false;
      }
      return true;
    });
  }, [tenants, statusFilter, search]);

  const resetCreate = () => {
    setName("");
    setSlug("");
    setSlugTouched(false);
  };

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return toast.error("Name is required");
    if (!/^[a-z0-9-]{3,60}$/.test(slug))
      return toast.error("Slug must be 3–60 chars: lowercase letters, digits, hyphens");

    setSaving(true);
    const { error } = await supabase.from("tenants").insert({
      name: trimmedName,
      slug,
      status: "active",
    });
    setSaving(false);

    if (error) return toast.error(error.message);
    toast.success("Tenant successfully created");
    resetCreate();
    setOpenCreate(false);
    qc.invalidateQueries({ queryKey: ["all-tenants-super"] });
  };

  const openEditModal = (t: TenantRow) => {
    setEditingTenant(t);
    setEditName(t.name);
    setEditStatus(t.status);
    setEditEmail(t.support_email ?? "");
    setEditPhone(t.support_phone ?? "");
  };

  const handleSaveEdit = async () => {
    if (!editingTenant) return;
    const trimmed = editName.trim();
    if (!trimmed) return toast.error("Name cannot be empty");

    setSavingEdit(true);
    const { error } = await supabase
      .from("tenants")
      .update({
        name: trimmed,
        status: editStatus,
        support_email: editEmail.trim() || null,
        support_phone: editPhone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editingTenant.id);
    setSavingEdit(false);

    if (error) return toast.error(error.message);
    toast.success("Tenant configuration updated");
    setEditingTenant(null);
    qc.invalidateQueries({ queryKey: ["all-tenants-super"] });
  };

  const toggleTenantStatus = async (t: TenantRow) => {
    const nextStatus = t.status === "active" ? "suspended" : "active";
    const confirmMsg =
      nextStatus === "suspended"
        ? `Are you sure you want to suspend "${t.name}"? Subscribed users may be impacted.`
        : `Reactivate "${t.name}"?`;

    if (!window.confirm(confirmMsg)) return;

    const { error } = await supabase
      .from("tenants")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", t.id);

    if (error) return toast.error(error.message);
    toast.success(`Tenant ${t.name} is now ${nextStatus}`);
    qc.invalidateQueries({ queryKey: ["all-tenants-super"] });
  };

  const activeCount = tenants.filter((t) => t.status === "active").length;
  const suspendedCount = tenants.filter((t) => t.status === "suspended").length;
  const totalFleet = tenants.reduce((s, t) => s + t.routerCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenant ISP & Quota Governance"
        description="Manage ISP organizations and tenant lifecycles. Platform commission is fixed at 2% for hotspot / voucher income and 1% for PPPoE income."
        action={
          <Dialog
            open={openCreate}
            onOpenChange={(o) => {
              setOpenCreate(o);
              if (!o) resetCreate();
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1" /> New ISP Tenant
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Provision New ISP Tenant</DialogTitle>
              </DialogHeader>
              <div className="space-y-3.5 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="t-name">Organization Name</Label>
                  <Input
                    id="t-name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!slugTouched) setSlug(slugify(e.target.value));
                    }}
                    placeholder="Savannah Hotspots Ltd"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-slug">Tenant Slug (Subdomain identifier)</Label>
                  <Input
                    id="t-slug"
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value.toLowerCase());
                    }}
                    placeholder="savannah-hotspots"
                  />
                  <p className="text-xs text-muted-foreground">
                    Captive portal will resolve at /p/{slug || "slug"}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <p className="font-medium">Platform commission</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Fixed at 2% of hotspot / voucher income and 1% of PPPoE income.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenCreate(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={saving}>
                  {saving ? "Provisioning…" : "Provision Tenant"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Top Level Metric Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Building2}
          label="Total Tenants"
          value={tenants.length}
          hint="Registered ISP partners"
        />
        <StatCard
          icon={ShieldCheck}
          label="Active & Operating"
          value={activeCount}
          hint={
            tenants.length ? `${Math.round((activeCount / tenants.length) * 100)}% active` : "—"
          }
        />
        <StatCard
          icon={ShieldAlert}
          label="Suspended / On Hold"
          value={suspendedCount}
          hint={suspendedCount > 0 ? "Requires review" : "No suspended accounts"}
        />
        <StatCard
          icon={RouterIcon}
          label="Total Routers Managed"
          value={totalFleet}
          hint="Across all tenant fleets"
        />
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card p-3 rounded-xl border">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tenant name, slug, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant={statusFilter === "all" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setStatusFilter("all")}
          >
            All ({tenants.length})
          </Button>
          <Button
            variant={statusFilter === "active" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs text-emerald-600 dark:text-emerald-400"
            onClick={() => setStatusFilter("active")}
          >
            Active ({activeCount})
          </Button>
          <Button
            variant={statusFilter === "suspended" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs text-amber-600 dark:text-amber-400"
            onClick={() => setStatusFilter("suspended")}
          >
            Suspended ({suspendedCount})
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading tenants…</p>
      ) : !filteredTenants.length ? (
        <EmptyState
          title="No tenants found"
          description="Try adjusting your search criteria or create a new tenant."
        />
      ) : (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Tenant Organization</th>
                  <th className="px-4 py-3 text-left">Slug</th>
                  <th className="px-4 py-3 text-center">Routers</th>
                  <th className="px-4 py-3 text-center">Commission</th>
                  <th className="px-4 py-3 text-right">Gross GMV</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.map((t) => (
                  <tr key={t.id} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <div className="font-medium text-foreground">{t.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.support_email ?? "No contact email"}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <span className="bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        {t.slug}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs">
                      <span className="font-semibold">{t.routerCount}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="outline" className="font-mono text-xs">
                        Hotspot 2% · PPPoE 1%
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-medium">
                      KES {t.gmv.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={t.status === "active" ? "default" : "secondary"}
                        className={`capitalize text-xs ${
                          t.status === "active"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                            : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                        }`}
                      >
                        {t.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => openEditModal(t)}
                        >
                          <Sliders className="h-3.5 w-3.5 mr-1" /> Configure
                        </Button>
                        <Button
                          variant={t.status === "active" ? "outline" : "default"}
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => toggleTenantStatus(t)}
                        >
                          {t.status === "active" ? "Suspend" : "Activate"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Tenant & Quotas Modal */}
      <Dialog open={!!editingTenant} onOpenChange={(o) => !o && setEditingTenant(null)}>
        {editingTenant && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Configure Tenant: {editingTenant.name}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Tenant Name</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-status">Account Lifecycle Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger id="edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active (Full operations)</SelectItem>
                    <SelectItem value="suspended">Suspended (Service paused)</SelectItem>
                    <SelectItem value="delinquent">Delinquent (Pending payment)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-email">Support Contact Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="admin@tenant.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-phone">Support Contact Phone</Label>
                <Input
                  id="edit-phone"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="+2547..."
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditingTenant(null)}
                disabled={savingEdit}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
