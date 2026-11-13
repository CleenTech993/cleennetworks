import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Archive, Download, FileUp, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { CSV_TEMPLATES, parseCsv, type CsvTable, type CsvTemplateKind } from "@/lib/csv-import";
import { randomCode } from "@/lib/codes";

export const Route = createFileRoute("/tenant/migration")({
  head: () => ({
    meta: [
      { title: "Backup & Migration — Tenant console" },
      {
        name: "description",
        content: "Download tenant operational data or migrate records from CSV.",
      },
    ],
  }),
  component: BackupAndMigration,
});

type ImportKind = CsvTemplateKind;
type PackageRow = TablesInsert<"packages">;
type CustomerRow = TablesInsert<"customers">;
type VoucherRow = TablesInsert<"vouchers">;
type Catalog = {
  packages: Pick<Tables<"packages">, "id" | "name" | "kind">[];
  routers: Pick<Tables<"routers">, "id" | "name" | "mac_address">[];
  customers: Pick<
    Tables<"customers">,
    "customer_type" | "full_name" | "phone" | "pppoe_username"
  >[];
  vouchers: Pick<Tables<"vouchers">, "code">[];
};
type ImportPlan = {
  packages: PackageRow[];
  customers: CustomerRow[];
  vouchers: VoucherRow[];
  legacyAccessCodes: {
    customerName: string;
    phone: string;
    code: string;
    packageName: string;
    expiresAt: string;
  }[];
  errors: string[];
  warnings: string[];
  skipped: number;
};

const PAGE_SIZE = 1_000;

async function fetchAll<T>(
  readPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await readPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function normalizeMac(value: string) {
  return value.trim().replace(/[:.-]/g, "").toLowerCase();
}

function optionalInteger(value: string, field: string, minimum = 0): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${field} must be a whole number greater than or equal to ${minimum}`);
  }
  return parsed;
}

function requiredNumber(value: string, field: string, minimum = 0): number {
  if (!value) throw new Error(`${field} is required`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${field} must be a number greater than or equal to ${minimum}`);
  }
  return parsed;
}

function optionalDate(value: string, field: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid date`);
  return parsed.toISOString();
}

function optionalBoolean(value: string, field: string): boolean | null {
  const normalized = normalize(value);
  if (!normalized) return null;
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  throw new Error(`${field} must be true or false`);
}

function resolvePackage(row: Record<string, string>, catalog: Catalog) {
  const name = normalize(row.package_name ?? "");
  if (!name) return null;
  const kind = normalize(row.package_kind ?? "");
  const matches = catalog.packages.filter(
    (pkg) => normalize(pkg.name) === name && (!kind || normalize(pkg.kind) === kind),
  );
  if (matches.length === 0) throw new Error(`Package "${row.package_name}" was not found`);
  if (matches.length > 1)
    throw new Error(`Package "${row.package_name}" is ambiguous; add package_kind`);
  return matches[0];
}

function buildImportPlan(
  kind: ImportKind,
  csv: CsvTable,
  catalog: Catalog,
  tenantId: string,
): ImportPlan {
  const plan: ImportPlan = {
    packages: [],
    customers: [],
    vouchers: [],
    legacyAccessCodes: [],
    errors: [],
    warnings: [],
    skipped: 0,
  };
  const seen = new Set<string>();

  for (const [index, row] of csv.rows.entries()) {
    const line = index + 2;
    try {
      if (kind === "packages") {
        const name = row.name?.trim();
        const packageKind = normalize(row.kind ?? "");
        if (!name) throw new Error("name is required");
        if (!["hotspot", "pppoe", "voucher", "hotspot_tv"].includes(packageKind)) {
          throw new Error("kind must be hotspot, pppoe, voucher, or hotspot_tv");
        }
        const key = `${normalize(name)}:${packageKind}`;
        if (
          seen.has(key) ||
          catalog.packages.some((pkg) => `${normalize(pkg.name)}:${normalize(pkg.kind)}` === key)
        ) {
          plan.skipped += 1;
          seen.add(key);
          continue;
        }
        const price = requiredNumber(row.price ?? "", "price");
        const durationValue = optionalInteger(row.duration_value ?? "", "duration_value", 1);
        const durationUnit = normalize(row.duration_unit ?? "");
        const allowedUnits = ["minutes", "hours", "days", "weeks", "months"];
        if (durationValue !== null && !allowedUnits.includes(durationUnit)) {
          throw new Error("duration_unit must be minutes, hours, days, weeks, or months");
        }
        const active = optionalBoolean(row.active ?? "", "active") ?? true;
        const dataLimit = optionalInteger(row.data_limit_mb ?? "", "data_limit_mb", 1);
        const unlimited = optionalBoolean(row.unlimited ?? "", "unlimited") ?? dataLimit === null;
        plan.packages.push({
          tenant_id: tenantId,
          name,
          kind: packageKind,
          price,
          description: row.description?.trim() || null,
          duration_value: durationValue,
          duration_unit: durationValue === null ? null : durationUnit,
          download_kbps: optionalInteger(row.download_kbps ?? "", "download_kbps"),
          upload_kbps: optionalInteger(row.upload_kbps ?? "", "upload_kbps"),
          burst_kbps: optionalInteger(row.burst_kbps ?? "", "burst_kbps"),
          data_limit_mb: dataLimit,
          unlimited,
          device_limit: optionalInteger(row.device_limit ?? "", "device_limit", 1) ?? 1,
          simultaneous_logins:
            optionalInteger(row.simultaneous_logins ?? "", "simultaneous_logins", 1) ?? 1,
          idle_timeout_sec: optionalInteger(row.idle_timeout_sec ?? "", "idle_timeout_sec", 1),
          session_timeout_sec: optionalInteger(
            row.session_timeout_sec ?? "",
            "session_timeout_sec",
            1,
          ),
          mac_binding: optionalBoolean(row.mac_binding ?? "", "mac_binding") ?? false,
          fup_download_kbps:
            optionalInteger(row.fup_download_kbps ?? "", "fup_download_kbps") ?? 512,
          fup_upload_kbps: optionalInteger(row.fup_upload_kbps ?? "", "fup_upload_kbps") ?? 256,
          active,
        });
        seen.add(key);
        continue;
      }

      if (kind === "customers") {
        const customerType = normalize(row.customer_type ?? "");
        if (customerType !== "pppoe" && customerType !== "hotspot") {
          throw new Error("customer_type must be pppoe or hotspot");
        }
        const pkg = resolvePackage(row, catalog);
        if (
          pkg &&
          ((customerType === "pppoe" && normalize(pkg.kind) !== "pppoe") ||
            (customerType === "hotspot" && normalize(pkg.kind) === "pppoe"))
        ) {
          throw new Error(`Package "${pkg.name}" does not match ${customerType}`);
        }
        const username = row.pppoe_username?.trim() || null;
        const password = row.pppoe_password?.trim() || null;
        let routerId: string | null = null;
        if (customerType === "pppoe") {
          if (!username) throw new Error("pppoe_username is required for PPPoE customers");
          const routerMac = normalizeMac(row.router_mac ?? "");
          if (!/^[0-9a-f]{12}$/.test(routerMac)) {
            throw new Error("router_mac must identify the assigned PPPoE router");
          }
          const routers = catalog.routers.filter(
            (router) => normalizeMac(router.mac_address ?? "") === routerMac,
          );
          if (routers.length !== 1)
            throw new Error("router_mac must match exactly one tenant router");
          routerId = routers[0].id;
          if (
            password &&
            [...password].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
          ) {
            throw new Error("pppoe_password cannot contain control characters");
          }
        } else if (username || password) {
          throw new Error("PPPoE credentials can only be set for PPPoE customers");
        }

        const fullName = row.full_name?.trim() || null;
        const phone = row.phone?.trim() || null;
        const duplicateKey =
          customerType === "pppoe"
            ? `pppoe:${normalize(username ?? "")}`
            : fullName && phone
              ? `hotspot:${normalize(fullName)}:${normalize(phone)}`
              : "";
        if (
          duplicateKey &&
          (seen.has(duplicateKey) ||
            catalog.customers.some((customer) =>
              customer.customer_type === customerType
                ? customerType === "pppoe"
                  ? normalize(customer.pppoe_username ?? "") === normalize(username ?? "")
                  : normalize(customer.full_name ?? "") === normalize(fullName ?? "") &&
                    normalize(customer.phone ?? "") === normalize(phone ?? "")
                : false,
            ))
        ) {
          plan.skipped += 1;
          if (duplicateKey) seen.add(duplicateKey);
          continue;
        }
        if (duplicateKey) seen.add(duplicateKey);
        const status = normalize(row.status ?? "") || "active";
        if (!["active", "suspended", "expired", "pending"].includes(status)) {
          throw new Error("status must be active, suspended, expired, or pending");
        }
        const effectiveStatus =
          customerType === "pppoe" && !password && status === "active" ? "suspended" : status;
        if (effectiveStatus !== status) {
          plan.warnings.push(
            `Row ${line}: PPPoE customer imported as suspended because no password was supplied`,
          );
        }
        const email = row.email?.trim() || null;
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new Error("email must be a valid email address");
        }
        plan.customers.push({
          tenant_id: tenantId,
          full_name: fullName,
          phone,
          email,
          customer_type: customerType,
          pppoe_username: username,
          pppoe_password: password,
          package_id: pkg?.id ?? null,
          router_id: routerId,
          static_ip: row.static_ip?.trim() || null,
          status: effectiveStatus,
          expires_at: optionalDate(row.expires_at ?? "", "expires_at"),
        });
        continue;
      }

      const legacyCashAccess =
        optionalBoolean(row.legacy_cash_access ?? "", "legacy_cash_access") ?? false;
      let code = row.code?.trim() ?? "";
      if (!code && !legacyCashAccess) throw new Error("code is required");
      if (!code) {
        do {
          code = randomCode(10);
        } while (
          seen.has(normalize(code)) ||
          catalog.vouchers.some((voucher) => normalize(voucher.code) === normalize(code))
        );
      }
      code = code.toUpperCase();
      const codeKey = normalize(code);
      if (
        seen.has(codeKey) ||
        catalog.vouchers.some((voucher) => normalize(voucher.code) === codeKey)
      ) {
        plan.skipped += 1;
        seen.add(codeKey);
        continue;
      }
      const pkg = resolvePackage(row, catalog);
      if (!pkg) throw new Error("package_name is required");
      if (normalize(pkg.kind) === "pppoe")
        throw new Error("Voucher package cannot be a PPPoE package");
      const status = normalize(row.status ?? "") || "unused";
      if (!["unused", "used", "expired"].includes(status)) {
        throw new Error("status must be unused, used, or expired");
      }
      const expiresAt = optionalDate(row.expires_at ?? "", "expires_at");
      if (legacyCashAccess) {
        if (status !== "unused") {
          throw new Error("legacy cash access must have status unused");
        }
        if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
          throw new Error("legacy cash access requires a future paid-through expires_at date");
        }
      }
      plan.vouchers.push({
        tenant_id: tenantId,
        code,
        package_id: pkg.id,
        status,
        expires_at: expiresAt,
        bound_mac: row.bound_mac?.trim() || null,
        used_at: optionalDate(row.used_at ?? "", "used_at"),
        used_by_mac: row.used_by_mac?.trim() || null,
        legacy_cash_access: legacyCashAccess,
      });
      if (legacyCashAccess) {
        plan.legacyAccessCodes.push({
          customerName: row.customer_name?.trim() || "",
          phone: row.phone?.trim() || "",
          code,
          packageName: pkg.name,
          expiresAt,
        });
      }
      seen.add(codeKey);
    } catch (error) {
      plan.errors.push(`Row ${line}: ${error instanceof Error ? error.message : "Invalid row"}`);
    }
  }
  return plan;
}

function BackupAndMigration() {
  const { tenantId } = useAuth();
  const queryClient = useQueryClient();
  const [importKind, setImportKind] = useState<ImportKind>("packages");
  const [csv, setCsv] = useState<CsvTable | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [legacyAccessCodes, setLegacyAccessCodes] = useState<ImportPlan["legacyAccessCodes"]>([]);

  const catalogQuery = useQuery({
    queryKey: ["tenant-migration-catalog", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<Catalog> => {
      const [packages, routers, customers, vouchers] = await Promise.all([
        fetchAll((from, to) =>
          supabase
            .from("packages")
            .select("id,name,kind")
            .eq("tenant_id", tenantId!)
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase
            .from("routers")
            .select("id,name,mac_address")
            .eq("tenant_id", tenantId!)
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase
            .from("customers")
            .select("customer_type,full_name,phone,pppoe_username")
            .eq("tenant_id", tenantId!)
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase.from("vouchers").select("code").eq("tenant_id", tenantId!).range(from, to),
        ),
      ]);
      return { packages, routers, customers, vouchers };
    },
  });

  const plan = useMemo(() => {
    if (!csv || !tenantId || !catalogQuery.data) return null;
    return buildImportPlan(importKind, csv, catalogQuery.data, tenantId);
  }, [csv, importKind, tenantId, catalogQuery.data]);

  const backup = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Tenant account is not available");
      const [packages, customers, routers, vouchers, portals, payments] = await Promise.all([
        fetchAll((from, to) =>
          supabase
            .from("packages")
            .select(
              "id,name,kind,price,description,duration_value,duration_unit,data_limit_mb,unlimited,upload_kbps,download_kbps,burst_kbps,device_limit,simultaneous_logins,idle_timeout_sec,session_timeout_sec,mac_binding,active,fup_download_kbps,fup_upload_kbps,created_at",
            )
            .eq("tenant_id", tenantId)
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase
            .from("customers")
            .select(
              "id,full_name,phone,email,customer_type,status,pppoe_username,package_id,router_id,expires_at,static_ip,created_at",
            )
            .eq("tenant_id", tenantId)
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase
            .from("routers")
            .select("id,name,model,serial,vendor,status,mac_address,public_ip")
            .eq("tenant_id", tenantId)
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase
            .from("vouchers")
            .select(
              "id,package_id,code,status,used_at,used_by_mac,bound_mac,expires_at,created_at,legacy_cash_access",
            )
            .eq("tenant_id", tenantId)
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase
            .from("captive_portals")
            .select(
              "id,logo_url,background_url,primary_color,welcome_text,terms_text,enable_voucher,enable_otp,post_login_url,theme,updated_at",
            )
            .eq("tenant_id", tenantId)
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase
            .from("payments")
            .select(
              "id,customer_id,package_id,phone,amount,mpesa_receipt,status,created_at,expires_at,provider,tv_device_id,voucher_code",
            )
            .eq("tenant_id", tenantId)
            .range(from, to),
        ),
      ]);
      return {
        format: "netgrid-tenant-backup",
        version: 1,
        exported_at: new Date().toISOString(),
        tenant_id: tenantId,
        included: ["packages", "customers", "routers", "vouchers", "captive_portals", "payments"],
        excluded: [
          "PPPoE passwords",
          "Router credentials, provision tokens, and integration secrets",
          "Payment provider credentials and raw payment callbacks",
          "Transient session and live bandwidth telemetry",
        ],
        records: { packages, customers, routers, vouchers, captive_portals: portals, payments },
      };
    },
    onSuccess: (payload) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `netgrid-backup-${tenantId}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      toast.success("Operational backup downloaded");
    },
    onError: (error: Error) => toast.error(`Backup failed: ${error.message}`),
  });

  const importMutation = useMutation({
    mutationFn: async (currentPlan: ImportPlan) => {
      if (!tenantId) throw new Error("Tenant account is not available");
      let imported = 0;
      if (importKind === "packages" && currentPlan.packages.length > 0) {
        const { error } = await supabase.from("packages").insert(currentPlan.packages);
        if (error) throw error;
        imported = currentPlan.packages.length;
      } else if (importKind === "customers" && currentPlan.customers.length > 0) {
        const { error } = await supabase.from("customers").insert(currentPlan.customers);
        if (error) throw error;
        imported = currentPlan.customers.length;
      } else if (importKind === "vouchers" && currentPlan.vouchers.length > 0) {
        const { error } = await supabase.from("vouchers").insert(currentPlan.vouchers);
        if (error) throw error;
        imported = currentPlan.vouchers.length;
      }
      return {
        imported,
        skipped: currentPlan.skipped,
        legacyAccessCodes: importKind === "vouchers" ? currentPlan.legacyAccessCodes : [],
      };
    },
    onSuccess: ({ imported, skipped, legacyAccessCodes: importedLegacyCodes }) => {
      toast.success(
        `Imported ${imported} records${skipped ? `; skipped ${skipped} duplicates` : ""}`,
      );
      setLegacyAccessCodes(importedLegacyCodes);
      setCsv(null);
      setFileName("");
      setFileError("");
      void queryClient.invalidateQueries({ queryKey: ["tenant-migration-catalog", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["packages"] });
    },
    onError: (error: Error) => toast.error(`Import failed: ${error.message}`),
  });

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATES[importKind]], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `netgrid-${importKind}-template.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function downloadLegacyAccessCodes() {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [
      ["customer_name", "phone", "voucher_code", "package", "paid_through"],
      ...legacyAccessCodes.map((item) => [
        item.customerName,
        item.phone,
        item.code,
        item.packageName,
        item.expiresAt,
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(escape).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `legacy-hotspot-access-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function readCsv(file: File | undefined) {
    setCsv(null);
    setFileName("");
    setFileError("");
    setLegacyAccessCodes([]);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setFileError("CSV files must be 5 MB or smaller");
      return;
    }
    try {
      const parsed = parseCsv(await file.text());
      setCsv(parsed);
      setFileName(file.name);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Could not read the CSV file");
    }
  }

  const catalogError = catalogQuery.error instanceof Error ? catalogQuery.error.message : "";

  return (
    <div>
      <PageHeader
        title="Backup & Migration"
        description="Download a tenant-scoped operational backup or import packages, customers, and vouchers from CSV."
      />

      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <Archive className="mt-1 h-5 w-5 text-primary" />
          <div className="flex-1">
            <h2 className="font-semibold">Download operational backup</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Creates a versioned JSON snapshot of packages, customers, routers, vouchers, captive
              portal settings, and payment history for this tenant only.
            </p>
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>
                The file contains customer contact details and voucher codes. PPPoE passwords,
                router credentials, integration secrets, raw payment callbacks, and live session
                telemetry are excluded. Store the downloaded file securely.
              </p>
            </div>
          </div>
        </div>
        <Button
          className="mt-4"
          onClick={() => backup.mutate()}
          disabled={!tenantId || backup.isPending}
        >
          <Download className="h-4 w-4" />
          {backup.isPending ? "Preparing backup…" : "Download backup"}
        </Button>
      </section>

      <section className="mt-6 rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <FileUp className="mt-1 h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold">Migrate data from CSV</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Export CSV files from the previous system, download a matching template, then preview
              before importing. Import packages first so customer and voucher package names can be
              mapped. PPPoE routers are matched by MAC address.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="migration-kind">Data to import</Label>
            <Select
              value={importKind}
              onValueChange={(value) => {
                if (value === "packages" || value === "customers" || value === "vouchers") {
                  setImportKind(value);
                  setCsv(null);
                  setFileName("");
                  setFileError("");
                  setLegacyAccessCodes([]);
                }
              }}
            >
              <SelectTrigger id="migration-kind" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="packages">Packages and speeds</SelectItem>
                <SelectItem value="customers">PPPoE and hotspot customers</SelectItem>
                <SelectItem value="vouchers">Hotspot vouchers</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4" />
              Download CSV template
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {importKind === "packages" &&
            "Package kind must be hotspot, pppoe, voucher, or hotspot_tv. Durations use minutes, hours, days, weeks, or months. Speed values are in kbps."}
          {importKind === "customers" &&
            "Customer type must be pppoe or hotspot. Match packages by package_name and package_kind; PPPoE customers also require a router_mac already registered to this tenant."}
          {importKind === "vouchers" &&
            "For existing cash customers without voucher codes, leave code blank, set legacy_cash_access=true, status=unused, and expires_at to the exact paid-through date/time (include a timezone). The system generates new codes; access ends on that date and is not extended on first connection. Routers refresh voucher access every 10 seconds and disconnect expired sessions. Other voucher imports require a code."}
        </p>

        <div className="mt-4">
          <Label htmlFor="migration-csv">CSV file (maximum 5 MB and 5,000 rows)</Label>
          <input
            id="migration-csv"
            key={importKind}
            type="file"
            accept=".csv,text/csv"
            className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-2"
            onChange={(event) => {
              void readCsv(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </div>

        {fileError && <p className="mt-3 text-sm text-destructive">{fileError}</p>}
        {catalogError && (
          <p className="mt-3 text-sm text-destructive">
            Could not load tenant mappings: {catalogError}
          </p>
        )}
        {catalogQuery.isLoading && (
          <p className="mt-3 text-sm text-muted-foreground">
            Loading package, router, and duplicate mappings…
          </p>
        )}
        {fileName && plan && (
          <div className="mt-4 rounded-lg border p-4">
            <h3 className="font-medium">Preview: {fileName}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.packages.length + plan.customers.length + plan.vouchers.length} ready to import
              {plan.skipped ? ` · ${plan.skipped} duplicates will be skipped` : ""}
              {plan.errors.length ? ` · ${plan.errors.length} rows need correction` : ""}
            </p>
            {importKind === "customers" && (
              <p className="mt-2 text-xs text-muted-foreground">
                PPPoE passwords are accepted only from your selected CSV and are not included in
                downloadable backups. Rows without a password are imported suspended for safety.
              </p>
            )}
            {plan.errors.length > 0 && (
              <ul className="mt-3 max-h-40 list-inside list-disc overflow-auto text-sm text-destructive">
                {plan.errors.slice(0, 20).map((error) => (
                  <li key={error}>{error}</li>
                ))}
                {plan.errors.length > 20 && (
                  <li>And {plan.errors.length - 20} more rows with errors</li>
                )}
              </ul>
            )}
            {plan.warnings.length > 0 && (
              <ul className="mt-3 max-h-32 list-inside list-disc overflow-auto text-sm text-amber-700">
                {plan.warnings.slice(0, 10).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
                {plan.warnings.length > 10 && (
                  <li>And {plan.warnings.length - 10} more warnings</li>
                )}
              </ul>
            )}
            {plan.errors.length > 0 && (
              <p className="mt-3 text-sm">
                Correct the errors in the CSV and upload it again. No records will be imported while
                errors remain.
              </p>
            )}
            <Button
              className="mt-4"
              onClick={() => importMutation.mutate(plan)}
              disabled={
                catalogQuery.isLoading ||
                !!catalogError ||
                importMutation.isPending ||
                plan.errors.length > 0 ||
                plan.packages.length + plan.customers.length + plan.vouchers.length === 0
              }
            >
              {importMutation.isPending ? "Importing…" : "Import valid rows"}
            </Button>
          </div>
        )}
        {legacyAccessCodes.length > 0 && (
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="font-medium">New legacy hotspot codes are ready</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep this file private and send each customer their code. Their access stops on the
              paid-through date; no cash payment entry was created.
            </p>
            <Button className="mt-3" variant="outline" onClick={downloadLegacyAccessCodes}>
              <Download className="h-4 w-4" /> Download customer codes
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
