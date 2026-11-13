import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gift, Router, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { randomCode } from "@/lib/codes";
import { formatDuration } from "@/lib/duration";
import { grantStaffInternet, type StaffInternetGrantResult } from "@/lib/staff-internet.functions";
import { listTeam, type TeamMember } from "@/lib/team.functions";

type AccessType = "hotspot" | "pppoe" | "both";

type GrantRow = {
  id: string;
  staff_user_id: string | null;
  staff_name: string;
  access_type: "hotspot" | "pppoe";
  package_name: string;
  retail_value: number;
  voucher_code: string | null;
  pppoe_username: string | null;
  note: string | null;
  expires_at: string;
  created_at: string;
};

function displayName(member: TeamMember): string {
  return (
    member.full_name?.trim() ||
    [member.first_name, member.last_name].filter(Boolean).join(" ").trim() ||
    member.email ||
    "Technician"
  );
}

function price(value: number | string | null): string {
  return `KES ${Number(value ?? 0).toLocaleString("en-KE")}`;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard.");
  } catch (error) {
    console.error("Could not copy staff internet credentials", error);
    toast.error("Could not copy the connection details. Please select and copy them manually.");
  }
}

export function StaffInternetGrants({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [staffUserId, setStaffUserId] = useState("");
  const [accessType, setAccessType] = useState<AccessType>("both");
  const [hotspotPackageId, setHotspotPackageId] = useState("");
  const [pppoePackageId, setPppoePackageId] = useState("");
  const [routerId, setRouterId] = useState("");
  const [pppoeUsername, setPppoeUsername] = useState("");
  const [pppoePassword, setPppoePassword] = useState("");
  const [note, setNote] = useState("");
  const [grantResult, setGrantResult] = useState<StaffInternetGrantResult | null>(null);

  const teamQuery = useQuery({
    queryKey: ["staff-internet-technicians", tenantId],
    queryFn: async () => {
      const result = await listTeam();
      if (!result.ok) throw new Error(result.error);
      return result.members.filter((member) => member.roles.includes("technician"));
    },
  });
  const packagesQuery = useQuery({
    queryKey: ["staff-internet-packages", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packages")
        .select("id,name,kind,price,duration_value,duration_unit")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .in("kind", ["hotspot", "voucher", "pppoe"])
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const routersQuery = useQuery({
    queryKey: ["staff-internet-routers", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routers")
        .select("id,name")
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const grantsQuery = useQuery({
    queryKey: ["staff-internet-grants", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_internet_grants")
        .select(
          "id,staff_user_id,staff_name,access_type,package_name,retail_value,voucher_code,pppoe_username,note,expires_at,created_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as GrantRow[];
    },
  });

  const technicians = teamQuery.data ?? [];
  const packages = packagesQuery.data ?? [];
  const hotspotPackages = packages.filter(
    (pkg) => pkg.kind === "hotspot" || pkg.kind === "voucher",
  );
  const pppoePackages = packages.filter((pkg) => pkg.kind === "pppoe");
  const hotspotPackage = hotspotPackages.find((pkg) => pkg.id === hotspotPackageId);
  const pppoePackage = pppoePackages.find((pkg) => pkg.id === pppoePackageId);

  const grant = useMutation({
    mutationFn: () =>
      grantStaffInternet({
        data: {
          tenantId,
          staffUserId,
          accessType,
          ...(accessType !== "pppoe" ? { hotspotPackageId } : {}),
          ...(accessType !== "hotspot"
            ? { pppoePackageId, routerId, pppoeUsername, pppoePassword }
            : {}),
          note,
        },
      }),
    onSuccess: (result) => {
      setGrantResult(result);
      toast.success("Complimentary internet access granted.");
      void queryClient.invalidateQueries({ queryKey: ["staff-internet-grants", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      void queryClient.invalidateQueries({ queryKey: ["pppoe-customers"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function resetForm() {
    setStaffUserId("");
    setAccessType("both");
    setHotspotPackageId("");
    setPppoePackageId("");
    setRouterId("");
    setPppoeUsername("");
    setPppoePassword("");
    setNote("");
    setGrantResult(null);
  }

  function chooseTechnician(value: string) {
    setStaffUserId(value);
    setPppoeUsername(`tech_${value.replaceAll("-", "").slice(0, 12)}`);
    setPppoePassword(randomCode(10));
  }

  const formError =
    teamQuery.error ?? packagesQuery.error ?? routersQuery.error ?? grantsQuery.error;

  return (
    <section className="mb-6 rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-4">
        <div>
          <div className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Complimentary staff internet</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Grant a technician hotspot access, a PPPoE plan, or both. This is recorded as a staff
            benefit, not a payment, and is excluded from customer invoices.
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setOpen(true);
          }}
          disabled={!technicians.length || packagesQuery.isLoading || routersQuery.isLoading}
        >
          <Gift className="h-4 w-4" /> Grant internet
        </Button>
      </div>

      {formError ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          Could not load complimentary access data:{" "}
          {formError instanceof Error ? formError.message : "Try refreshing the page."}
        </p>
      ) : !technicians.length && !teamQuery.isLoading ? (
        <p className="p-4 text-sm text-muted-foreground">
          Add a technician to your team before granting staff internet.
        </p>
      ) : grantsQuery.isLoading ? (
        <p className="p-4 text-sm text-muted-foreground">Loading staff internet grants…</p>
      ) : grantsQuery.data?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Granted</th>
                <th className="p-3">Technician</th>
                <th className="p-3">Access</th>
                <th className="p-3">Plan</th>
                <th className="p-3">Retail value</th>
                <th className="p-3">Expires</th>
              </tr>
            </thead>
            <tbody>
              {grantsQuery.data.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="whitespace-nowrap p-3">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="p-3">
                    <span className="block font-medium">{row.staff_name}</span>
                    {row.note && <span className="text-xs text-muted-foreground">{row.note}</span>}
                  </td>
                  <td className="p-3">
                    <Badge variant="secondary">{row.access_type.toUpperCase()}</Badge>
                  </td>
                  <td className="p-3">
                    {row.package_name}
                    {row.voucher_code && (
                      <span className="block font-mono text-xs text-muted-foreground">
                        Code {row.voucher_code}
                      </span>
                    )}
                    {row.pppoe_username && (
                      <span className="block font-mono text-xs text-muted-foreground">
                        {row.pppoe_username}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3">{price(row.retail_value)}</td>
                  <td className="whitespace-nowrap p-3">
                    {new Date(row.expires_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t p-3 text-xs text-muted-foreground">
            Latest 100 grants. Retail value is informational; no payment was created.
          </p>
        </div>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">No complimentary access grants yet.</p>
      )}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetForm();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {grantResult ? "Internet access granted" : "Grant complimentary internet"}
            </DialogTitle>
            <DialogDescription>
              {grantResult
                ? "Share these connection details securely with the technician."
                : "Choose the technician and service plans. The selected retail value will not be charged."}
            </DialogDescription>
          </DialogHeader>
          {grantResult ? (
            <div className="space-y-4">
              {grantResult.hotspot_code && (
                <div className="rounded-lg border p-4">
                  <div className="flex items-center gap-2 font-medium">
                    <Wifi className="h-4 w-4" /> Hotspot voucher
                  </div>
                  <p className="mt-2 font-mono text-xl tracking-widest">
                    {grantResult.hotspot_code}
                  </p>
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    onClick={() => void copyText(grantResult.hotspot_code!)}
                  >
                    Copy hotspot code
                  </Button>
                </div>
              )}
              {grantResult.pppoe_username && grantResult.pppoe_password && (
                <div className="rounded-lg border p-4">
                  <div className="flex items-center gap-2 font-medium">
                    <Router className="h-4 w-4" /> PPPoE account
                  </div>
                  <p className="mt-2 text-sm">
                    Username: <code className="font-mono">{grantResult.pppoe_username}</code>
                  </p>
                  <p className="mt-1 text-sm">
                    Password: <code className="font-mono">{grantResult.pppoe_password}</code>
                  </p>
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void copyText(
                        `PPPoE username: ${grantResult.pppoe_username}\nPassword: ${grantResult.pppoe_password}`,
                      )
                    }
                  >
                    Copy PPPoE details
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    The router receives the account on its next sync, usually within two minutes.
                  </p>
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="staff-internet-technician">Technician</Label>
                <Select value={staffUserId} onValueChange={chooseTechnician}>
                  <SelectTrigger id="staff-internet-technician">
                    <SelectValue placeholder="Choose a technician" />
                  </SelectTrigger>
                  <SelectContent>
                    {technicians.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {displayName(member)}
                        {member.phone ? ` · ${member.phone}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="staff-internet-type">Access type</Label>
                <Select
                  value={accessType}
                  onValueChange={(value) => setAccessType(value as AccessType)}
                >
                  <SelectTrigger id="staff-internet-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hotspot">Hotspot voucher</SelectItem>
                    <SelectItem value="pppoe">PPPoE account</SelectItem>
                    <SelectItem value="both">Hotspot + PPPoE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {accessType !== "pppoe" && (
                <div className="grid gap-2">
                  <Label htmlFor="staff-hotspot-package">Hotspot package</Label>
                  <Select value={hotspotPackageId} onValueChange={setHotspotPackageId}>
                    <SelectTrigger id="staff-hotspot-package">
                      <SelectValue placeholder="Choose a package" />
                    </SelectTrigger>
                    <SelectContent>
                      {hotspotPackages.map((pkg) => (
                        <SelectItem key={pkg.id} value={pkg.id}>
                          {pkg.name} · {formatDuration(pkg.duration_value, pkg.duration_unit)} ·{" "}
                          {price(pkg.price)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {hotspotPackage && (
                    <p className="text-xs text-muted-foreground">
                      Retail value {price(hotspotPackage.price)} — technician pays KES 0.
                    </p>
                  )}
                </div>
              )}
              {accessType !== "hotspot" && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="staff-pppoe-package">PPPoE package</Label>
                    <Select value={pppoePackageId} onValueChange={setPppoePackageId}>
                      <SelectTrigger id="staff-pppoe-package">
                        <SelectValue placeholder="Choose a package" />
                      </SelectTrigger>
                      <SelectContent>
                        {pppoePackages.map((pkg) => (
                          <SelectItem key={pkg.id} value={pkg.id}>
                            {pkg.name} · {formatDuration(pkg.duration_value, pkg.duration_unit)} ·{" "}
                            {price(pkg.price)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {pppoePackage && (
                      <p className="text-xs text-muted-foreground">
                        Retail value {price(pppoePackage.price)} — technician pays KES 0.
                      </p>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="staff-pppoe-router">Router</Label>
                    <Select value={routerId} onValueChange={setRouterId}>
                      <SelectTrigger id="staff-pppoe-router">
                        <SelectValue placeholder="Choose a router" />
                      </SelectTrigger>
                      <SelectContent>
                        {(routersQuery.data ?? []).map((router) => (
                          <SelectItem key={router.id} value={router.id}>
                            {router.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="staff-pppoe-username">PPPoE username</Label>
                      <Input
                        id="staff-pppoe-username"
                        value={pppoeUsername}
                        onChange={(event) => setPppoeUsername(event.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="staff-pppoe-password">PPPoE password</Label>
                      <Input
                        id="staff-pppoe-password"
                        value={pppoePassword}
                        onChange={(event) => setPppoePassword(event.target.value)}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                </>
              )}
              <div className="grid gap-2">
                <Label htmlFor="staff-internet-note">Note (optional)</Label>
                <Input
                  id="staff-internet-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="For example, field technician allowance"
                  maxLength={200}
                />
              </div>
              {accessType === "both" && hotspotPackage && pppoePackage && (
                <p className="rounded-lg bg-muted p-3 text-sm">
                  Total retail value{" "}
                  {price(Number(hotspotPackage.price) + Number(pppoePackage.price))}. No payment or
                  customer invoice will be created.
                </p>
              )}
              <DialogFooter>
                <Button
                  onClick={() => grant.mutate()}
                  disabled={
                    grant.isPending ||
                    !staffUserId ||
                    (accessType !== "pppoe" && !hotspotPackageId) ||
                    (accessType !== "hotspot" &&
                      (!pppoePackageId || !routerId || !pppoeUsername || !pppoePassword))
                  }
                >
                  {grant.isPending ? "Granting access…" : "Grant access"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
