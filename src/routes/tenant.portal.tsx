import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PortalPreview } from "@/components/portal/preview";
import { ThemePicker } from "@/components/portal/theme-picker";
import {
  normalizeHex,
  resolveThemeId,
  PORTAL_THEMES,
  type PortalThemeId,
} from "@/lib/portal-themes";

export const Route = createFileRoute("/tenant/portal")({ component: PortalSettings });

function PortalSettings() {
  const { tenantId } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["captive-portal", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase
        .from("captive_portals")
        .select("*")
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      return data;
    },
  });

  const { data: tenant } = useQuery({
    queryKey: ["tenant-name", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", tenantId!)
        .maybeSingle();
      return data;
    },
  });

  const [form, setForm] = useState({
    theme: "classic" as PortalThemeId,
    primary_color: "#0ea5e9",
    logo_url: "",
    background_url: "",
    welcome_text: "",
    terms_text: "",
    enable_voucher: true,
    enable_otp: true,
  });

  useEffect(() => {
    if (data) {
      setForm({
        theme: resolveThemeId(data.theme),
        primary_color: data.primary_color ?? "#0ea5e9",
        logo_url: data.logo_url ?? "",
        background_url: data.background_url ?? "",
        welcome_text: data.welcome_text ?? "",
        terms_text: data.terms_text ?? "",
        enable_voucher: data.enable_voucher ?? true,
        enable_otp: data.enable_otp ?? true,
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const payload = { tenant_id: tenantId, ...form };
      if (data?.id) {
        const { error } = await supabase.from("captive_portals").update(payload).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("captive_portals").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Captive portal updated");
      qc.invalidateQueries({ queryKey: ["captive-portal"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const brand = normalizeHex(form.primary_color);

  return (
    <div>
      <PageHeader
        title="Captive Portal"
        description="Choose how your portal looks, then set your branding and login methods."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-6">
            <h2 className="font-semibold">Theme</h2>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">
              Each theme restyles the whole portal your customers see. Your colour and logo are
              applied on top.
            </p>
            <ThemePicker
              value={form.theme}
              onChange={(theme) => setForm({ ...form, theme })}
              brand={brand}
            />
            {form.theme === "venue" && !form.background_url && (
              <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                Venue shows your background image across the top. Add one below, or it falls back to
                your brand colour.
              </p>
            )}
            {!PORTAL_THEMES[form.theme].usesImages && (form.logo_url || form.background_url) && (
              <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                {PORTAL_THEMES[form.theme].name} loads no images, so your logo and background image
                are not shown with this theme.
              </p>
            )}
          </section>

          <section className="space-y-4 rounded-xl border bg-card p-6">
            <h2 className="font-semibold">Branding</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="pc-color">Brand colour</Label>
                <Input
                  id="pc-color"
                  type="color"
                  value={brand}
                  onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                  className="mt-1 h-10 w-full p-1"
                />
              </div>
              <div>
                <Label htmlFor="pc-logo">Logo URL</Label>
                <Input
                  id="pc-logo"
                  value={form.logo_url}
                  onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                  placeholder="https://…/logo.png"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="pc-bg">Background image URL</Label>
              <Input
                id="pc-bg"
                value={form.background_url}
                onChange={(e) => setForm({ ...form, background_url: e.target.value })}
                placeholder="https://…/bg.jpg"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Customers open the portal before they have internet, so images must load from your
                portal's own address or a host you've allowed on the router.
              </p>
            </div>
            <div>
              <Label htmlFor="pc-welcome">Welcome text</Label>
              <Textarea
                id="pc-welcome"
                rows={2}
                value={form.welcome_text}
                onChange={(e) => setForm({ ...form, welcome_text: e.target.value })}
                placeholder="Welcome to FastNet Wi-Fi. Choose a plan to get online."
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="pc-terms">Terms &amp; conditions</Label>
              <Textarea
                id="pc-terms"
                rows={4}
                value={form.terms_text}
                onChange={(e) => setForm({ ...form, terms_text: e.target.value })}
                className="mt-1"
              />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.enable_voucher}
                  onCheckedChange={(v) => setForm({ ...form, enable_voucher: v })}
                />{" "}
                Voucher login
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.enable_otp}
                  onCheckedChange={(v) => setForm({ ...form, enable_otp: v })}
                />{" "}
                Phone OTP
              </label>
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </section>
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <p className="mb-2 text-sm font-medium">Preview</p>
          <div className="mx-auto w-[24rem] max-w-full overflow-hidden rounded-[2rem] border-[6px] border-foreground/80 bg-background shadow-sm">
            <div className="h-[34rem] overflow-y-auto">
              <PortalPreview
                themeId={form.theme}
                brand={brand}
                name={tenant?.name ?? "Your business"}
                logoUrl={form.logo_url}
                backgroundUrl={form.background_url}
                welcomeText={form.welcome_text}
              />
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Sample plans. Your real plans appear on the live portal.
          </p>
        </aside>
      </div>
    </div>
  );
}
