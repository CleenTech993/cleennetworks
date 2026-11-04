import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Palette, Upload, Image as ImageIcon, Check, RefreshCw, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PortalPreview } from "@/components/portal/preview";
import { ThemePicker } from "@/components/portal/theme-picker";
import { parseHotspotDestinationUrl } from "@/lib/hotspot-redirect";
import { ImageUploader } from "@/components/portal/image-uploader";
import {
  normalizeHex,
  resolveThemeId,
  PORTAL_THEMES,
  type PortalThemeId,
} from "@/lib/portal-themes";

export const Route = createFileRoute("/tenant/portal")({
  head: () => ({
    meta: [
      { title: "Captive Portal Branding & Themes — Tenant Console" },
      { name: "description", content: "Customize your captive portal design, upload logos, set holiday and festive season themes." },
    ],
  }),
  component: PortalSettings,
});

const CURATED_PALETTES = [
  { name: "Electric Blue", color: "#0ea5e9" },
  { name: "Festive Cranberry", color: "#e11d48" },
  { name: "Champagne Gold", color: "#f59e0b" },
  { name: "Emerald Pine", color: "#10b981" },
  { name: "Royal Purple", color: "#8b5cf6" },
  { name: "Sunset Terracotta", color: "#ea580c" },
  { name: "Midnight Obsidian", color: "#18181b" },
];

const FESTIVE_WALLPAPERS = [
  {
    name: "Festive Christmas",
    theme: "festive" as PortalThemeId,
    color: "#e11d48",
    url: "https://images.unsplash.com/photo-1543257580-7269da773bf5?auto=format&fit=crop&w=1600&q=80",
    welcome: "🎄 Happy Holidays! Enjoy complimentary high-speed Wi-Fi.",
  },
  {
    name: "New Year Fireworks",
    theme: "celebration" as PortalThemeId,
    color: "#f59e0b",
    url: "https://images.unsplash.com/photo-1531306728370-e2ebd9d7bb99?auto=format&fit=crop&w=1600&q=80",
    welcome: "🎆 Welcome to 2027! High-speed internet for all your celebrations.",
  },
  {
    name: "Tropical Palm Resort",
    theme: "tropical" as PortalThemeId,
    color: "#0891b2",
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80",
    welcome: "🌊 Welcome to the Resort Wi-Fi. Relax and connect.",
  },
  {
    name: "Ramadan Starlight",
    theme: "ramadan" as PortalThemeId,
    color: "#047857",
    url: "https://images.unsplash.com/photo-1519817650390-64a93db51149?auto=format&fit=crop&w=1600&q=80",
    welcome: "🌙 Ramadan Mubarak. Stay connected with family & friends.",
  },
  {
    name: "Savannah Acacia",
    theme: "safari" as PortalThemeId,
    color: "#c2410c",
    url: "https://images.unsplash.com/photo-1516426122078-c23e76319801?auto=format&fit=crop&w=1600&q=80",
    welcome: "🦁 Welcome to Safari Lodge Wi-Fi. Fast & reliable in the wild.",
  },
];

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
    post_login_url: "",
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
        post_login_url: data.post_login_url ?? "",
        enable_voucher: data.enable_voucher ?? true,
        enable_otp: data.enable_otp ?? true,
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant");
      const redirectInput = form.post_login_url.trim();
      const postLoginUrl = redirectInput ? parseHotspotDestinationUrl(redirectInput) : null;
      if (redirectInput && !postLoginUrl)
        throw new Error("Enter a valid http or https destination URL.");
      const payload = { tenant_id: tenantId, ...form, post_login_url: postLoginUrl };
      if (data?.id) {
        const { error } = await supabase.from("captive_portals").update(payload).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("captive_portals").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Captive portal design & branding saved");
      qc.invalidateQueries({ queryKey: ["captive-portal"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const brand = normalizeHex(form.primary_color);

  function applyFestivePreset(preset: typeof FESTIVE_WALLPAPERS[0]) {
    setForm({
      ...form,
      theme: preset.theme,
      primary_color: preset.color,
      background_url: preset.url,
      welcome_text: preset.welcome,
    });
    toast.success(`Applied "${preset.name}" festive design`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Captive Portal Studio"
        description="Design your captive portal: upload logos, set festive season themes, and customize login experiences."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          {/* Quick Festive Theme Presets */}
          <section className="rounded-xl border bg-card p-6 shadow-xs">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <h2 className="font-semibold text-base">Holiday & Seasonal 1-Click Packs</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Instantly transform your captive portal for holidays, festive seasons, and events with matching themes and greeting.
            </p>

            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {FESTIVE_WALLPAPERS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => applyFestivePreset(preset)}
                  className="flex items-center gap-3 rounded-lg border p-2.5 text-left hover:bg-muted/50 hover:border-primary/40 transition-all group"
                >
                  <div
                    className="h-10 w-10 rounded-md shrink-0 bg-cover bg-center border shadow-xs"
                    style={{ backgroundImage: `url(${preset.url})` }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-xs text-foreground group-hover:text-primary transition-colors">
                      {preset.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{preset.theme}</p>
                  </div>
                  <Wand2 className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors" />
                </button>
              ))}
            </div>
          </section>

          {/* Theme Picker */}
          <section className="rounded-xl border bg-card p-6 shadow-xs">
            <h2 className="font-semibold text-base">Portal Design & Theme</h2>
            <p className="mb-4 mt-1 text-xs text-muted-foreground">
              Select a design style. Each theme formats the header, buttons, and voucher cards to match your venue.
            </p>
            <ThemePicker
              value={form.theme}
              onChange={(theme) => setForm({ ...form, theme })}
              brand={brand}
            />
          </section>

          {/* Image Uploads & Branding */}
          <section className="space-y-6 rounded-xl border bg-card p-6 shadow-xs">
            <div>
              <h2 className="font-semibold text-base">ISP Branding & Image Uploads</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upload your company logo and background wallpaper. Images are optimized and loaded directly onto the captive portal.
              </p>
            </div>

            {/* Logo Uploader */}
            <ImageUploader
              label="Company Logo"
              description="Appears in the header of the captive portal. Square or transparent PNG is recommended."
              value={form.logo_url}
              onChange={(val) => setForm({ ...form, logo_url: val })}
              aspectRatio="square"
              maxDimension={512}
              placeholder="https://example.com/logo.png"
              tenantId={tenantId}
            />

            {/* Background Uploader */}
            <ImageUploader
              label="Background Wallpaper / Hero Banner"
              description="Used in Venue, Tropical, Safari, and Custom Studio themes. Upload high-definition photos or festive artwork."
              value={form.background_url}
              onChange={(val) => setForm({ ...form, background_url: val })}
              aspectRatio="landscape"
              maxDimension={1600}
              placeholder="https://example.com/wallpaper.jpg"
              tenantId={tenantId}
            />

            {/* Brand Color & Presets */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Brand Accent Colour</Label>
              <div className="flex flex-wrap items-center gap-2">
                {CURATED_PALETTES.map((p) => (
                  <button
                    key={p.color}
                    type="button"
                    onClick={() => setForm({ ...form, primary_color: p.color })}
                    className={`h-7 w-7 rounded-full border-2 flex items-center justify-center transition-all ${
                      brand === p.color ? "border-foreground scale-110 shadow-xs" : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: p.color }}
                    title={p.name}
                  >
                    {brand === p.color && <Check className="h-3.5 w-3.5 text-white drop-shadow" />}
                  </button>
                ))}
                <div className="flex items-center gap-2 ml-2">
                  <Input
                    type="color"
                    value={brand}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                    className="h-8 w-12 p-0.5 rounded cursor-pointer"
                  />
                  <span className="font-mono text-xs text-muted-foreground uppercase">{brand}</span>
                </div>
              </div>
            </div>

            {/* Text Inputs */}
            <div className="space-y-4 pt-2 border-t">
              <div>
                <Label htmlFor="pc-welcome" className="text-xs">
                  Welcome Greeting
                </Label>
                <Textarea
                  id="pc-welcome"
                  rows={2}
                  value={form.welcome_text}
                  onChange={(e) => setForm({ ...form, welcome_text: e.target.value })}
                  placeholder="Welcome to HighSpeed Wi-Fi. Choose a plan to connect."
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <Label htmlFor="pc-terms" className="text-xs">
                  Terms &amp; Conditions / Acceptable Use Policy
                </Label>
                <Textarea
                  id="pc-terms"
                  rows={3}
                  value={form.terms_text}
                  onChange={(e) => setForm({ ...form, terms_text: e.target.value })}
                  placeholder="Fair use policy applies. Commercial spamming and unauthorized peer-to-peer distribution is prohibited."
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <Label htmlFor="pc-post-login-url" className="text-xs">
                  After-connection destination URL
                </Label>
                <Input
                  id="pc-post-login-url"
                  type="url"
                  maxLength={2048}
                  value={form.post_login_url}
                  onChange={(e) => setForm({ ...form, post_login_url: e.target.value })}
                  placeholder="https://your-system.example"
                  className="mt-1 text-xs"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  After login, send customers here. Leave blank to return them to the page they originally opened.
                </p>
              </div>

              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Switch
                    checked={form.enable_voucher}
                    onCheckedChange={(v) => setForm({ ...form, enable_voucher: v })}
                  />
                  Voucher Login Method
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Switch
                    checked={form.enable_otp}
                    onCheckedChange={(v) => setForm({ ...form, enable_otp: v })}
                  />
                  Phone Number OTP
                </label>
              </div>
            </div>

            <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full sm:w-auto">
              {save.isPending ? "Saving changes…" : "Save Portal Branding"}
            </Button>
          </section>
        </div>

        {/* Live Mobile Device Preview */}
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold">Live Phone Preview</p>
            <Badge variant="outline" className="text-[10px] capitalize">
              {form.theme} theme
            </Badge>
          </div>
          <div className="mx-auto w-[24rem] max-w-full overflow-hidden rounded-[2.5rem] border-[8px] border-zinc-800 bg-background shadow-xl relative">
            <div className="h-6 w-32 bg-zinc-800 rounded-b-xl mx-auto absolute top-0 left-1/2 -translate-x-1/2 z-20" />
            <div className="h-[36rem] overflow-y-auto">
              <PortalPreview
                themeId={form.theme}
                brand={brand}
                name={tenant?.name ?? "Your Wi-Fi Network"}
                logoUrl={form.logo_url}
                backgroundUrl={form.background_url}
                welcomeText={form.welcome_text}
              />
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Interactive phone preview. Test tabs and buttons directly.
          </p>
        </aside>
      </div>
    </div>
  );
}
