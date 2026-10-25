import { PORTAL_THEME_LIST, themeVars, type PortalThemeId } from "@/lib/portal-themes";

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

/** Radio group of portal themes. Native radios, so keyboard (arrow keys) and screen readers just work. */
export function ThemePicker({
  value,
  onChange,
  brand,
}: {
  value: PortalThemeId;
  onChange: (id: PortalThemeId) => void;
  brand: string;
}) {
  return (
    <fieldset>
      <legend className="sr-only">Portal theme</legend>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {PORTAL_THEME_LIST.map((t) => (
          <label
            key={t.id}
            className="relative flex cursor-pointer flex-col gap-2 rounded-lg border bg-background p-3 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          >
            <input
              type="radio"
              name="portal-theme"
              value={t.id}
              checked={value === t.id}
              onChange={() => onChange(t.id)}
              className="sr-only"
            />
            <Swatch id={t.id} brand={brand} />
            <span className="font-medium leading-none">{t.name}</span>
            <span className="text-xs leading-snug text-muted-foreground">{t.tagline}</span>
            <span className="text-xs leading-snug text-muted-foreground/80">
              Best for: {t.bestFor}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
