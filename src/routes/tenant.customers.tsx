import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, RefreshCw, Copy } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { randomCode, addDuration } from "@/lib/codes";

export const Route = createFileRoute("/tenant/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Tenant console" },
      { name: "description", content: "Search, add and reconnect hotspot and PPPoE customers." },
    ],
  }),
  component: Customers,
});

type Customer = {
  id: string;
  full_name: string | null;
  phone: string | null;
  customer_type: string;
  status: string;
  pppoe_username: string | null;
  package_id: string | null;
  expires_at: string | null;
};

const emptyForm = {
  full_name: "",
  phone: "",
  customer_type: "hotspot",
  pppoe_username: "",
  pppoe_password: "",
  package_id: "",
  router_id: "",
};

function Customers() {
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [reconnect, setReconnect] = useState<Customer | null>(null);
  const [rcPkg, setRcPkg] = useState("");
  const [issued, setIssued] = useState<string | null>(null);

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Customer[];
    },
  });
  const { data: packages } = useQuery({
    queryKey: ["packages-min"],
    queryFn: async () =>
      (
        await supabase
          .from("packages")
          .select("id,name,kind,duration_value,duration_unit")
          .eq("active", true)
      ).data ?? [],
  });
  const { data: routers } = useQuery({
    queryKey: ["routers-min"],
    queryFn: async () => (await supabase.from("routers").select("id,name")).data ?? [],
  });
  const { data: receipts } = useQuery({
    queryKey: ["payments-receipts"],
    queryFn: async () =>
      (
        await supabase
          .from("payments")
          .select("phone,mpesa_receipt,voucher_code")
          .not("mpesa_receipt", "is", null)
          .limit(1000)
      ).data ?? [],
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !customers) return customers ?? [];
    const phones = new Set(
      (receipts ?? [])
        .filter(
          (r) =>
            r.mpesa_receipt?.toLowerCase().includes(s) || r.voucher_code?.toLowerCase().includes(s),
        )
        .map((r) => r.phone),
    );
    return customers.filter(
      (c) =>
        [c.full_name, c.phone, c.pppoe_username].some((v) => v?.toLowerCase().includes(s)) ||
        (c.phone && phones.has(c.phone)),
    );
  }, [q, customers, receipts]);

  const create = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const isPppoe = form.customer_type === "pppoe";
      if (
        isPppoe &&
        (!/^[A-Za-z0-9._@-]{3,64}$/.test(form.pppoe_username) ||
          !/^[A-Za-z0-9._@-]{4,64}$/.test(form.pppoe_password))
      )
        throw new Error("Username/password: letters, numbers, . _ @ - only (min 3/4 chars)");
      const pkg = packages?.find((p) => p.id === form.package_id);
      const { error } = await supabase.from("customers").insert({
        tenant_id: tenantId,
        full_name: form.full_name,
        phone: form.phone,
        customer_type: form.customer_type,
        status: "active",
        pppoe_username: isPppoe ? form.pppoe_username : null,
        pppoe_password: isPppoe ? form.pppoe_password : null,
        package_id: form.package_id || null,
        router_id: form.router_id || null,
        expires_at: pkg ? addDuration(pkg.duration_value, pkg.duration_unit).toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Customer added — router picks it up within 2 minutes");
      qc.invalidateQueries({ queryKey: ["customers"] });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const issueVoucher = useMutation({
    mutationFn: async () => {
      if (!tenantId || !reconnect) throw new Error("No tenant");
      const pkg = packages?.find((p) => p.id === rcPkg);
      if (!pkg) throw new Error("Choose a package");
      const code = randomCode(8);
      const expires = addDuration(pkg.duration_value, pkg.duration_unit).toISOString();
      const { error } = await supabase.from("vouchers").insert({
        tenant_id: tenantId,
        package_id: pkg.id,
        code,
        status: "unused",
        expires_at: expires,
      });
      if (error) throw error;
      await supabase
        .from("customers")
        .update({ status: "active", package_id: pkg.id, expires_at: expires })
        .eq("id", reconnect.id);
      return code;
    },
    onSuccess: (code) => {
      setIssued(code);
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Hotspot and PPPoE subscribers."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" /> Add customer
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New customer</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                <div>
                  <Label>Full name</Label>
                  <Input
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="2547XXXXXXXX"
                  />
                </div>
                <div>
                  <Label>Type</Label>
                  <Select
                    value={form.customer_type}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        customer_type: v,
                        pppoe_password:
                          v === "pppoe" && !form.pppoe_password
                            ? randomCode(8)
                            : form.pppoe_password,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hotspot">Hotspot</SelectItem>
                      <SelectItem value="pppoe">PPPoE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.customer_type === "pppoe" && (
                  <>
                    <div>
                      <Label>PPPoE username</Label>
                      <Input
                        value={form.pppoe_username}
                        onChange={(e) => setForm({ ...form, pppoe_username: e.target.value })}
                        placeholder="e.g. john.house12"
                      />
                    </div>
                    <div>
                      <Label>PPPoE password</Label>
                      <div className="flex gap-2">
                        <Input
                          value={form.pppoe_password}
                          onChange={(e) => setForm({ ...form, pppoe_password: e.target.value })}
                          className="font-mono"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setForm({ ...form, pppoe_password: randomCode(8) })}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
                <div>
                  <Label>Package</Label>
                  <Select
                    value={form.package_id}
                    onValueChange={(v) => setForm({ ...form, package_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select package" />
                    </SelectTrigger>
                    <SelectContent>
                      {packages?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Router (optional — blank means all routers)</Label>
                  <Select
                    value={form.router_id}
                    onValueChange={(v) => setForm({ ...form, router_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All routers" />
                    </SelectTrigger>
                    <SelectContent>
                      {routers?.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => create.mutate()}
                  disabled={create.isPending || !form.full_name}
                >
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone, PPPoE username or M-Pesa code"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !filtered.length ? (
        <EmptyState
          title="No customers"
          description={
            q ? "No customer matches your search." : "Add your first hotspot or PPPoE customer."
          }
        />
      ) : (
        <div className="rounded-xl border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left">Name</th>
                <th className="px-4 py-2.5 text-left">Phone</th>
                <th className="px-4 py-2.5 text-left">Type</th>
                <th className="px-4 py-2.5 text-left">Status</th>
                <th className="px-4 py-2.5 text-left">Expires</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2.5 font-medium">
                    {c.full_name}
                    {c.pppoe_username && (
                      <div className="font-mono text-xs text-muted-foreground">
                        {c.pppoe_username}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">{c.phone ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline">{c.customer_type}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={c.status === "active" ? "default" : "secondary"}>
                      {c.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {c.expires_at ? new Date(c.expires_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReconnect(c);
                        setRcPkg(c.package_id ?? "");
                        setIssued(null);
                      }}
                    >
                      Reconnect
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!reconnect} onOpenChange={(o) => !o && setReconnect(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reconnect {reconnect?.full_name}</DialogTitle>
            <DialogDescription>
              Issue a voucher code. The customer enters it on the hotspot login page (as username
              and password) to get back online.
            </DialogDescription>
          </DialogHeader>
          {issued ? (
            <div className="rounded-lg border bg-muted/40 p-4 text-center">
              <p className="text-xs text-muted-foreground">Voucher code</p>
              <p className="my-2 font-mono text-3xl font-bold tracking-widest">{issued}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(issued);
                  toast.success("Copied");
                }}
              >
                <Copy className="h-4 w-4" /> Copy
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                Ready on the router within 2 minutes.
              </p>
            </div>
          ) : (
            <div>
              <Label>Package</Label>
              <Select value={rcPkg} onValueChange={setRcPkg}>
                <SelectTrigger>
                  <SelectValue placeholder="Select package" />
                </SelectTrigger>
                <SelectContent>
                  {packages?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.duration_value} {p.duration_unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            {!issued && (
              <Button
                onClick={() => issueVoucher.mutate()}
                disabled={issueVoucher.isPending || !rcPkg}
              >
                Issue voucher
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
