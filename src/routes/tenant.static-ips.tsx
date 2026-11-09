import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Globe, Pencil, Search } from "lucide-react";
import { EmptyState, PageHeader, StatCard } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tenant/static-ips")({
  head: () => ({
    meta: [
      { title: "Static IPs — Tenant console" },
      { name: "description", content: "Manage static IPv4 assignments for PPPoE customers." },
    ],
  }),
  component: StaticIps,
});

type Customer = {
  id: string;
  full_name: string | null;
  phone: string | null;
  pppoe_username: string | null;
  status: string;
  static_ip: string | null;
};

function isIpv4(value: string) {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
  );
}

function StaticIps() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [ip, setIp] = useState("");

  const {
    data: customers,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["static-ip-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,full_name,phone,pppoe_username,status,static_ip")
        .eq("customer_type", "pppoe")
        .order("full_name");
      if (error) throw error;
      return data as Customer[];
    },
  });

  const assignIp = useMutation({
    mutationFn: async ({ customer, value }: { customer: Customer; value: string | null }) => {
      if (value) {
        if (!isIpv4(value)) throw new Error("Enter a valid IPv4 address.");
        const { data: conflicts, error: conflictError } = await supabase
          .from("customers")
          .select("id")
          .eq("static_ip", value)
          .neq("id", customer.id)
          .limit(1);
        if (conflictError) throw conflictError;
        if (conflicts.length) throw new Error("That IP address is already assigned.");
      }

      const { error } = await supabase
        .from("customers")
        .update({ static_ip: value })
        .eq("id", customer.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Static IP assignment updated.");
      void qc.invalidateQueries({ queryKey: ["static-ip-customers"] });
      void qc.invalidateQueries({ queryKey: ["pppoe-customers"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers ?? [];
    return (customers ?? []).filter((customer) =>
      [customer.full_name, customer.phone, customer.pppoe_username, customer.static_ip].some(
        (value) => value?.toLowerCase().includes(query),
      ),
    );
  }, [customers, search]);
  const assignedCount = (customers ?? []).filter((customer) => customer.static_ip).length;

  const openEditor = (customer: Customer) => {
    setEditing(customer);
    setIp(customer.static_ip ?? "");
  };

  return (
    <div>
      <PageHeader
        title="Static IPs"
        description="Assign and manage IPv4 addresses for PPPoE customers. Routers apply changes on their next sync."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Assigned" value={assignedCount} icon={Globe} />
        <StatCard label="Without an IP" value={(customers ?? []).length - assignedCount} />
        <StatCard label="PPPoE customers" value={customers?.length ?? 0} />
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search customer, username, phone or IP"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading static IP assignments…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load static IP assignments: {error.message}
        </p>
      ) : !filtered.length ? (
        <EmptyState
          title={search ? "No matching customers" : "No PPPoE customers"}
          description={
            search
              ? "Try another search term."
              : "Add PPPoE customers before assigning static IP addresses."
          }
          icon={Globe}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left">Customer</th>
                <th className="px-4 py-2.5 text-left">Phone</th>
                <th className="px-4 py-2.5 text-left">Static IP</th>
                <th className="px-4 py-2.5 text-left">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((customer) => (
                <tr key={customer.id} className="border-t">
                  <td className="px-4 py-2.5 font-medium">
                    {customer.full_name || "Unnamed customer"}
                    {customer.pppoe_username && (
                      <div className="font-mono text-xs text-muted-foreground">
                        {customer.pppoe_username}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">{customer.phone ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono">{customer.static_ip ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={customer.static_ip ? "default" : "outline"}>
                      {customer.static_ip ? "Assigned" : "Unassigned"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="outline" onClick={() => openEditor(customer)}>
                      <Pencil className="h-4 w-4" />
                      {customer.static_ip ? "Edit" : "Assign IP"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Static IP assignment</DialogTitle>
            <DialogDescription>
              {editing?.full_name || editing?.pppoe_username || "PPPoE customer"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="static-ip">IPv4 address</Label>
            <Input
              id="static-ip"
              value={ip}
              onChange={(event) => setIp(event.target.value.trim())}
              placeholder="192.0.2.10"
              inputMode="decimal"
              autoComplete="off"
            />
          </div>
          <DialogFooter className="sm:justify-between">
            <div>
              {editing?.static_ip && (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={assignIp.isPending}
                  onClick={() => editing && assignIp.mutate({ customer: editing, value: null })}
                >
                  Remove assignment
                </Button>
              )}
            </div>
            <Button
              disabled={
                !editing ||
                assignIp.isPending ||
                (ip !== "" && (!isIpv4(ip) || ip === editing.static_ip))
              }
              onClick={() =>
                editing && assignIp.mutate({ customer: editing, value: ip.trim() || null })
              }
            >
              Save assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
