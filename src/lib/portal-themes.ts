// Captive-portal themes. Pure functions (no env / DB / DOM access) so they are unit-testable.
//
// A theme is a set of CSS-variable overrides applied to one wrapper element. Every shadcn
// component inside (buttons, inputs, tabs, cards) already reads those variables, so the whole
// portal re-skins without touching the components. Layout differences (header, plan list) are
// chosen by the `header` / `plan` fields below.
//
// Rules every theme follows, because the portal is opened on phones, often on a weak link and
// before the device has internet access (only the portal's own host is reachable):
//   - no web fonts beyond the two the app already bundles, plus system stacks;
//   - images are optional and never required for the page to make sense.

export const PORTAL_THEME_IDS = ["classic", "midnight", "ticket", "block", "venue", "lite"] as const;
export type PortalThemeId = (typeof PORTAL_THEME_IDS)[number];
export const DEFAULT_PORTAL_THEME: PortalThemeId = "classic";

export type HeaderKind = "centered" | "left" | "block" | "photo" | "plain";
export type PlanKind = "card" | "bars" | "ticket" | "block" | "leader";

export interface PortalThemeDef {
  id: PortalThemeId;
  name: string;
  tagline: string;
  bestFor: string;
  dark: boolean;
  header: HeaderKind;
  plan: PlanKind;
  /** Content sits on a rounded sheet that overlaps the header photo. */
  sheet: boolean;
  /** Uses the ISP's logo / background image. When false the theme loads no images at all. */
  usesImages: boolean;
}

export const PORTAL_THEMES: Record<PortalThemeId, PortalThemeDef> = {
  classic: {
    id: "classic", name: "Classic", dark: false, header: "centered", plan: "card", sheet: false, usesImages: true,
    tagline: "Clean and familiar, tinted with your brand colour.",
    bestFor: "Any business. This is how portals looked before themes.",
  },
  midnight: {
    id: "midnight", name: "Midnight", dark: true, header: "left", plan: "bars", sheet: false, usesImages: true,
    tagline: "Dark and easy on the eyes, with signal bars showing each plan's speed.",
    bestFor: "Bars, lounges and hotels used in the evening.",
  },
  ticket: {
    id: "ticket", name: "Ticket", dark: false, header: "centered", plan: "ticket", sheet: false, usesImages: true,
    tagline: "Plans look like tear-off prepaid tickets in your brand colour.",
    bestFor: "Kiosks and shops that sell printed vouchers.",
  },
  block: {
    id: "block", name: "Block", dark: false, header: "block", plan: "block", sheet: false, usesImages: true,
    tagline: "Flat colour, heavy outlines and hard shadows.",
    bestFor: "Students, cyber cafés and youth-focused networks.",
  },
  venue: {
    id: "venue", name: "Venue", dark: false, header: "photo", plan: "card", sheet: true, usesImages: true,
    tagline: "Your photo fills the top; plans slide up over it.",
    bestFor: "Hotels, restaurants and estates with a good photo. Set a background image.",
  },
  lite: {
    id: "lite", name: "Lite", dark: false, header: "plain", plan: "leader", sheet: false, usesImages: false,
    tagline: "A plain receipt-style list. No images, system fonts, loads fast.",
    bestFor: "Slow connections and older phones.",
  },
};

export const PORTAL_THEME_LIST: PortalThemeDef[] = PORTAL_THEME_IDS.map((id) => PORTAL_THEMES[id]);

/** Unknown / missing / tampered values fall back to the default theme. */
export function resolveThemeId(value: unknown): PortalThemeId {
  return typeof value === "string" && (PORTAL_THEME_IDS as readonly string[]).includes(value)
    ? (value as PortalThemeId)
    : DEFAULT_PORTAL_THEME;
}

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

export const DEFAULT_BRAND = "#0ea5e9";
const DARK_TEXT = "#0f141a";
const WHITE = "#ffffff";

/** "#abc" / "abc" / "#AABBCC" -> "#aabbcc". Anything else -> fallback. Always safe to embed in CSS. */
export function normalizeHex(input: string | null | undefined, fallback: string = DEFAULT_BRAND): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((input ?? "").trim());
  if (!m) return fallback;
  let h = m[1]!.toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h}`;
}

function toRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex([r, g, b]: [number, number, number]): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Blend: t=0 gives `a`, t=1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 (none) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Text colour for use ON `bg`: whichever of white / near-black contrasts more. `whiteMin` forces
 * white when white's contrast is at least that value (Classic uses it so the default blue keeps
 * the white text portals always had).
 */
export function readableOn(bg: string, whiteMin?: number): string {
  const cw = contrastRatio(bg, WHITE);
  if (whiteMin !== undefined && cw >= whiteMin) return WHITE;
  return cw >= contrastRatio(bg, DARK_TEXT) ? WHITE : DARK_TEXT;
}

function toHsl(hex: string): [number, number, number] {
  const [r8, g8, b8] = toRgb(hex);
  const r = r8 / 255, g = g8 / 255, b = b8 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** Hue in degrees (0-360). */
export function hueOf(hex: string): number {
  return toHsl(hex)[0];
}

/**
 * Makes `color` lighter or darker (towards whichever end contrasts with `against`) until it
 * reaches `min`, keeping its hue and saturation so a navy brand on a dark surface becomes a
 * brighter blue rather than a grey. Returns it unchanged when it already has enough contrast.
 */
export function ensureContrast(color: string, against: string, min: number): string {
  const c = normalizeHex(color);
  if (contrastRatio(c, against) >= min) return c;
  const [h, s, l] = toHsl(c);
  const lighter = luminance(against) < 0.5;
  for (let step = 1; step <= 50; step++) {
    const nl = lighter ? Math.min(0.97, l + step * 0.02) : Math.max(0.03, l - step * 0.02);
    const candidate = fromHsl(h, s, nl);
    if (contrastRatio(candidate, against) >= min) return candidate;
  }
  return lighter ? "#ffffff" : "#000000";
}

/** Only http(s) image URLs are ever rendered. */
export function safeImageUrl(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  return /^https?:\/\/[^\s"'<>()]+$/i.test(u) ? u : null;
}

/** 0 (unknown) to 4 bars for a plan's download speed. */
export function speedBars(kbps: number | null | undefined): 0 | 1 | 2 | 3 | 4 {
  if (!kbps || kbps <= 0) return 0;
  if (kbps <= 2000) return 1;
  if (kbps <= 5000) return 2;
  if (kbps <= 10000) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Theme variables
// ---------------------------------------------------------------------------

const SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_SERIF = 'ui-serif, Georgia, Cambria, "Times New Roman", serif';
const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Fixed palettes. Text pairs were chosen (and are tested) to meet WCAG AA, 4.5:1.
const MIDNIGHT = {
  page: "#0e1a26", card: "#162636", fg: "#e6edf3", muted: "#1c3044", mutedFg: "#9fb2c4",
  border: "#263c52", input: "#2c455e",
};
const BLOCK_INK = "#1a1a1a";
const VENUE = { page: "#ffffff", card: "#f4f5f7", fg: "#14181f", muted: "#eceef2", mutedFg: "#566170", border: "#dfe3e8" };
const LITE = { page: "#ffffff", fg: "#1a1a1a", muted: "#f1f1f1", mutedFg: "#444444", border: "#1a1a1a" };

function accentVars(fill: string, whiteMin?: number): Record<string, string> {
  const on = readableOn(fill, whiteMin);
  return {
    "--primary": fill,
    "--primary-foreground": on,
    "--ring": fill,
    "--pt-accent": fill,
    "--pt-on-accent": on,
  };
}

/** Maps for the shadcn variables a theme overrides. */
function surface(v: {
  page: string; fg: string; card: string; cardFg?: string; muted: string; mutedFg: string; border: string; input?: string;
}): Record<string, string> {
  return {
    "--background": v.page,
    "--foreground": v.fg,
    "--card": v.card,
    "--card-foreground": v.cardFg ?? v.fg,
    "--popover": v.card,
    "--popover-foreground": v.cardFg ?? v.fg,
    "--secondary": v.muted,
    "--secondary-foreground": v.fg,
    "--muted": v.muted,
    "--muted-foreground": v.mutedFg,
    "--accent": v.muted,
    "--accent-foreground": v.fg,
    "--border": v.border,
    "--input": v.input ?? v.border,
  };
}

/**
 * CSS custom properties to set on the portal wrapper for `id`, derived from the ISP's brand
 * colour. Values only ever come from validated hex colours and constants, never raw input.
 */
export function themeVars(id: PortalThemeId, brandInput: string | null | undefined): Record<string, string> {
  const brand = normalizeHex(brandInput);

  switch (id) {
    case "midnight": {
      const fill = ensureContrast(brand, MIDNIGHT.card, 3);
      return {
        ...surface({ page: MIDNIGHT.page, fg: MIDNIGHT.fg, card: MIDNIGHT.card, muted: MIDNIGHT.muted, mutedFg: MIDNIGHT.mutedFg, border: MIDNIGHT.border, input: MIDNIGHT.input }),
        ...accentVars(fill),
        "--radius": "0.75rem",
      };
    }
    case "ticket": {
      const page = mix(brand, WHITE, 0.86);
      return {
        ...surface({ page, fg: "#1b2430", card: WHITE, muted: mix(brand, WHITE, 0.78), mutedFg: "#475160", border: mix(brand, WHITE, 0.62) }),
        ...accentVars(brand),
        "--radius": "0.75rem",
        "--pt-font-head": SYSTEM_SERIF,
        "--pt-font-mono": SYSTEM_MONO,
      };
    }
    case "block": {
      const page = mix(brand, WHITE, 0.9);
      return {
        ...surface({ page, fg: BLOCK_INK, card: WHITE, muted: mix(brand, WHITE, 0.8), mutedFg: "#40444c", border: BLOCK_INK }),
        ...accentVars(brand),
        "--radius": "0.25rem",
        "--pt-ink": BLOCK_INK,
        "--pt-font-head": "var(--font-display)",
      };
    }
    case "venue":
      return {
        ...surface({ page: VENUE.page, fg: VENUE.fg, card: VENUE.card, muted: VENUE.muted, mutedFg: VENUE.mutedFg, border: VENUE.border }),
        ...accentVars(brand),
        "--radius": "1rem",
        "--pt-font-head": "var(--font-display)",
      };
    case "lite":
      return {
        ...surface({ page: LITE.page, fg: LITE.fg, card: LITE.page, muted: LITE.muted, mutedFg: LITE.mutedFg, border: LITE.border }),
        ...accentVars(brand),
        "--radius": "0px",
        "--pt-font-body": SYSTEM_SANS,
        "--pt-font-head": SYSTEM_SANS,
        "--pt-font-mono": SYSTEM_MONO,
      };
    case "classic":
    default:
      // Same surfaces as before themes existed; only the accent is set (so unreadable button
      // text on very light brand colours is fixed). The default blue keeps its white text.
      return accentVars(brand, 2.5);
  }
}

/** The fill colour children should use for buttons / highlights under this theme. */
export function portalAccent(id: PortalThemeId, brandInput: string | null | undefined): string {
  return themeVars(id, brandInput)["--pt-accent"]!;
}
