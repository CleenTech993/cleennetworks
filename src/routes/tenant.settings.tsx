import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTenantLabels } from "@/hooks/use-tenant-customization";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { MfaSecurityCard } from "@/components/mfa-security-card";
import { TenantServiceCredentials } from "@/components/tenant-service-credentials";
import { SessionManagementCard } from "@/components/session-management-card";
import { TenantDomainSettings } from "@/components/tenant-domain-settings";
import {
  DEFAULT_TENANT_LABELS,
  sanitizeUserPreferences,
  type TenantLabels,
  type UserPreferences,
} from "@/lib/tenant-customization";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/tenant/settings")({ component: Settings });

const empty = {
  name: "",
  primary_color: "",
  logo_url: "",
  support_phone: "",
  support_email: "",
};

function Settings() {
  const qc = useQueryClient();
  const { tenantId, user } = useAuth();
  const {
    labels,
    isLoading: labelsLoading,
    isError: labelsError,
    refetch: refetchLabels,
  } = useTenantLabels();
  const {
    preferences,
    isLoading: preferencesLoading,
    isError: preferencesError,
    error: preferencesLoadError,
    refetch: refetchPreferences,
    savePreferences,
    isSaving: preferencesSaving,
  } = useUserPreferences();
  const [labelForm, setLabelForm] = useState<TenantLabels>(DEFAULT_TENANT_LABELS);
  const [preferencesForm, setPreferencesForm] = useState<UserPreferences>(preferences);
  const tenantQuery = useQuery({
    queryKey: ["tenant", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", tenantId!)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const tenant = tenantQuery.data;
  const portalDomainQuery = useQuery({
    queryKey: ["tenant-domain-url", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_domains")
        .select("domain,verified_at")
        .eq("tenant_id", tenantId!)
        .eq("purpose", "hotspot")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const portalDomain = portalDomainQuery.data;
  const [form, setForm] = useState(empty);
  useEffect(() => {
    if (tenant) {
      const t = tenant as unknown as Record<string, string | null>;
      setForm({
        name: t.name ?? "",
        primary_color: t.primary_color ?? "",
        logo_url: t.logo_url ?? "",
        support_phone: t.support_phone ?? "",
        support_email: t.support_email ?? "",
      });
    }
  }, [tenant]);

  useEffect(() => setLabelForm(labels), [labels]);
  useEffect(() => setPreferencesForm(preferences), [preferences]);

  const save = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Tenant account is not available.");
      if (!tenant) throw new Error("Tenant settings have not finished loading.");
      if (labelsLoading || labelsError)
        throw new Error("Tenant terminology has not finished loading.");
      const color = form.primary_color.trim();
      if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
        throw new Error("Brand color must be a six-digit hexadecimal color, such as #0ea5e9.");
      }
      const logoUrl = form.logo_url.trim();
      if (logoUrl) {
        const parsed = new URL(logoUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          throw new Error("Logo URL must use HTTPS or HTTP.");
        }
      }
      const uiLabels: Json = Object.fromEntries(
        Object.entries(labelForm).map(([key, value]) => [key, value.trim()]),
      );
      const { error } = await supabase
        .from("tenants")
        .update({
          ...form,
          primary_color: color || null,
          logo_url: logoUrl || null,
          ui_labels: uiLabels,
        })
        .eq("id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["tenant"] });
      qc.invalidateQueries({ queryKey: ["tenant-labels", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePreferencesMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in to save preferences.");
      if (preferencesLoading || preferencesError)
        throw new Error("Personal preferences have not finished loading.");
      const sanitized = sanitizeUserPreferences(preferencesForm);
      await savePreferences(sanitized);
    },
    onSuccess: () => toast.success("Personal preferences saved"),
    onError: (error: Error) => toast.error(error.message),
  });

  const slug = (tenant as { slug?: string } | undefined)?.slug;
  const canonicalHost = (import.meta.env.VITE_APP_CANONICAL_HOST ?? "").trim();
  const portalUrl =
    typeof window !== "undefined" && portalDomain?.verified_at
      ? `https://${portalDomain.domain}`
      : slug && typeof window !== "undefined"
        ? `${window.location.protocol}//${canonicalHost || window.location.host}/p/${slug}`
        : "";

  function field<K extends keyof typeof form>(k: K, label: string, placeholder?: string) {
    const id = `tenant-${k}`;
    return (
      <div>
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          value={form[k]}
          placeholder={placeholder}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          className="mt-1"
        />
      </div>
    );
  }

  function labelField<K extends keyof TenantLabels>(key: K, title: string) {
    return (
      <div>
        <Label htmlFor={`label-${key}`}>{title}</Label>
        <Input
          id={`label-${key}`}
          value={labelForm[key]}
          maxLength={40}
          onChange={(event) => setLabelForm({ ...labelForm, [key]: event.target.value })}
          className="mt-1"
        />
      </div>
    );
  }

  function updatePreferences<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setPreferencesForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Branding, receiving details, and customer support."
      />
      {tenantQuery.isPending && (
        <p className="mb-4 text-sm text-muted-foreground" role="status">
          Loading organization settings…
        </p>
      )}
      {tenantQuery.isError && (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4"
          role="alert"
        >
          <div>
            <p className="font-medium">Organization settings could not be loaded.</p>
            <p className="mt-1 text-sm text-muted-foreground">{tenantQuery.error.message}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void tenantQuery.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {portalDomainQuery.isError && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          Custom portal domain status could not be loaded: {portalDomainQuery.error.message}
        </p>
      )}
      {labelsError && (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4"
          role="alert"
        >
          <p className="text-sm text-destructive">
            Tenant terminology could not be loaded. Retry before editing or saving settings.
          </p>
          <Button type="button" variant="outline" onClick={() => void refetchLabels()}>
            Retry
          </Button>
        </div>
      )}
      {preferencesError && (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4"
          role="alert"
        >
          <p className="text-sm text-destructive">
            Personal preferences could not be loaded:{" "}
            {preferencesLoadError?.message ?? "Please retry."}
          </p>
          <Button type="button" variant="outline" onClick={() => void refetchPreferences()}>
            Retry
          </Button>
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold mb-4">ISP branding</h3>
          <div className="space-y-3">
            {field("name", "ISP name")}
            {field("primary_color", "Primary color", "#0ea5e9")}
            {field("logo_url", "Logo image URL", "https://example.com/logo.png")}
            {portalUrl && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <p className="text-muted-foreground">Public captive portal</p>
                <a
                  href={portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-primary break-all"
                >
                  {portalUrl}
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 md:col-span-2">
          <h3 className="mb-1 font-semibold">Portal branding and content</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Customize the hotspot welcome message, terms, logo, and theme from the captive portal
            designer.
          </p>
          <Button asChild type="button" variant="outline">
            <a href="/tenant/portal">Open captive portal designer</a>
          </Button>
        </div>

        <div className="rounded-xl border bg-card p-5 md:col-span-2">
          <h3 className="mb-1 font-semibold">Terminology and navigation labels</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Choose the words your team uses. These labels update tenant navigation and matching page
            headings.
          </p>
          {labelsLoading && (
            <p className="mb-3 text-sm text-muted-foreground" role="status">
              Loading tenant terminology…
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {labelField("overview", "Overview")}
            {labelField("noc", "NOC monitor")}
            {labelField("hotspot", "Hotspot")}
            {labelField("pppoe", "PPPoE")}
            {labelField("routers", "Routers")}
            {labelField("packages", "Packages")}
            {labelField("customers", "Customers")}
            {labelField("payments", "Payments")}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 md:col-span-2">
          <h3 className="mb-1 font-semibold">My preferences</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            These settings belong to your user account and apply when you sign in on another device.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="pref-theme">Theme</Label>
              <select
                id="pref-theme"
                value={preferencesForm.theme}
                onChange={(event) =>
                  updatePreferences("theme", event.target.value === "dark" ? "dark" : "light")
                }
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            <div>
              <Label htmlFor="pref-date-format">Date format</Label>
              <select
                id="pref-date-format"
                value={preferencesForm.dateFormat}
                onChange={(event) =>
                  updatePreferences(
                    "dateFormat",
                    event.target.value === "mdy"
                      ? "mdy"
                      : event.target.value === "iso"
                        ? "iso"
                        : "dmy",
                  )
                }
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="dmy">DD/MM/YYYY</option>
                <option value="mdy">MM/DD/YYYY</option>
                <option value="iso">YYYY-MM-DD</option>
              </select>
            </div>
            <div>
              <Label htmlFor="pref-time-zone">Time zone</Label>
              <select
                id="pref-time-zone"
                value={preferencesForm.timeZone}
                onChange={(event) => updatePreferences("timeZone", event.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="local">Device time zone</option>
                <option value="Africa/Nairobi">Africa/Nairobi (EAT)</option>
                <option value="UTC">UTC</option>
                <option value="Europe/London">Europe/London</option>
                <option value="America/New_York">America/New_York</option>
              </select>
            </div>
            <div>
              <Label htmlFor="pref-layout">Dashboard density</Label>
              <select
                id="pref-layout"
                value={preferencesForm.dashboardLayout}
                onChange={(event) =>
                  updatePreferences(
                    "dashboardLayout",
                    event.target.value === "compact" ? "compact" : "comfortable",
                  )
                }
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>
          </div>
          <Button
            className="mt-4"
            onClick={() => savePreferencesMutation.mutate()}
            disabled={
              preferencesLoading ||
              preferencesError ||
              savePreferencesMutation.isPending ||
              preferencesSaving
            }
          >
            {preferencesLoading
              ? "Loading preferences…"
              : savePreferencesMutation.isPending || preferencesSaving
                ? "Saving preferences…"
                : "Save my preferences"}
          </Button>
        </div>

        <div className="rounded-xl border bg-card p-5 md:col-span-2">
          <h3 className="font-semibold mb-4">Customer support</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {field("support_phone", "Support phone / WhatsApp")}
            {field("support_email", "Support / invoice email")}
            <p className="text-xs text-muted-foreground md:col-span-2">
              Monthly platform commission invoices are sent to this address.
            </p>
          </div>
        </div>
      </div>
      <div className="mt-6">
        <Button
          onClick={() => save.mutate()}
          disabled={
            save.isPending ||
            tenantQuery.isPending ||
            tenantQuery.isError ||
            !tenant ||
            labelsLoading ||
            labelsError
          }
        >
          {save.isPending ? "Saving changes…" : "Save changes"}
        </Button>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <TenantDomainSettings />
      </div>

      <TenantServiceCredentials />

      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-3">Security &amp; Authentication</h3>
        <MfaSecurityCard />
      </div>
      <SessionManagementCard />
    </div>
  );
}
