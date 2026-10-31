import { useState } from "react";
import { Sparkles, Calendar, Palette, Briefcase } from "lucide-react";
import { PORTAL_THEME_LIST, themeVars, type PortalThemeId, type PortalThemeDef } from "@/lib/portal-themes";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/** A tiny abstract sample of a theme, tinted with the ISP's own brand colour. */
function Swatch({ id, brand }: { id: PortalThemeId; brand: string }) {
  const v = themeVars(id, brand);
  const page = v["--background"] ?? "#f6f8f7";
  const card = v["--card"] ?? "#ffffff";
  const accent = v["--pt-accent"]!;
  const border = v["--border"] ?? "#dfe3e8";
  return (
    <span
      aria-hidden
      className="flex h-14 w-full flex-col justify-between rounded-md p-2 ring-1 ring-black/10"
      style={{ background: page }}
    >
      <span className="h-2 w-10 rounded-sm" style={{ background: accent }} />
      <span className="flex gap-1">
        <span
          className="h-4 flex-1 rounded-sm"
          style={{ background: card, boxShadow: `inset 0 0 0 1px ${border}` }}
        />
        <span className="h-4 w-6 rounded-sm" style={{ background: accent }} />
      </span>
    </span>
  );
}

function ThemeCard({
  theme,
  value,
  brand,
  onChange,
}: {
  theme: PortalThemeDef;
  value: PortalThemeId;
  brand: string;
  onChange: (id: PortalThemeId) => void;
}) {
  const checked = value === theme.id;
  return (
    <label
      className={`relative flex cursor-pointer flex-col gap-2 rounded-xl border p-3.5 transition-all ${
        checked
          ? "border-primary bg-primary/5 ring-2 ring-primary shadow-xs"
          : "bg-card hover:bg-muted/40 hover:border-muted-foreground/30"
      }`}
    >
      <input
        type="radio"
        name="portal-theme"
        value={theme.id}
        checked={checked}
        onChange={() => onChange(theme.id)}
        className="sr-only"
      />
      <Swatch id={theme.id} brand={brand} />
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm leading-none text-foreground">{theme.name}</span>
        {theme.dark && (
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            Dark
          </span>
        )}
      </div>
      <span className="text-xs leading-snug text-muted-foreground">{theme.tagline}</span>
      <span className="text-[11px] leading-snug text-muted-foreground/75 mt-auto pt-1 border-t border-border/50">
        Best for: {theme.bestFor}
      </span>
    </label>
  );
}

/** Grouped radio selector of portal themes with Holiday & Custom designs. */
export function ThemePicker({
  value,
  onChange,
  brand,
}: {
  value: PortalThemeId;
  onChange: (id: PortalThemeId) => void;
  brand: string;
}) {
  const businessThemes = PORTAL_THEME_LIST.filter((t) =>
    ["classic", "midnight", "ticket", "block", "venue", "lite"].includes(t.id)
  );

  const holidayThemes = PORTAL_THEME_LIST.filter((t) =>
    ["festive", "celebration", "tropical", "ramadan", "safari"].includes(t.id)
  );

  const customThemes = PORTAL_THEME_LIST.filter((t) => ["custom"].includes(t.id));

  // Default active tab based on selected value
  const initialTab = holidayThemes.some((t) => t.id === value)
    ? "holidays"
    : customThemes.some((t) => t.id === value)
      ? "custom"
      : "business";

  const [activeTab, setActiveTab] = useState(initialTab);

  return (
    <fieldset className="space-y-4">
      <legend className="sr-only">Portal theme</legend>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full sm:w-auto grid-cols-3 max-w-md">
          <TabsTrigger value="business" className="text-xs gap-1.5">
            <Briefcase className="h-3.5 w-3.5" />
            Standard
          </TabsTrigger>
          <TabsTrigger value="holidays" className="text-xs gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            Festive & Holiday
          </TabsTrigger>
          <TabsTrigger value="custom" className="text-xs gap-1.5">
            <Palette className="h-3.5 w-3.5 text-primary" />
            Custom Studio
          </TabsTrigger>
        </TabsList>

        <TabsContent value="business" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {businessThemes.map((t) => (
              <ThemeCard key={t.id} theme={t} value={value} brand={brand} onChange={onChange} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="holidays" className="mt-4">
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span>
              Special holiday and festive season themes crafted for celebrations, end-of-year sales, and seasonal promotions.
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {holidayThemes.map((t) => (
              <ThemeCard key={t.id} theme={t} value={value} brand={brand} onChange={onChange} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="custom" className="mt-4">
          <div className="mb-3 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary shrink-0" />
            <span>
              Custom Studio gives you complete freedom: upload your custom wallpaper, logo, and brand colors below.
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {customThemes.map((t) => (
              <ThemeCard key={t.id} theme={t} value={value} brand={brand} onChange={onChange} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </fieldset>
  );
}
