import { describe, expect, it } from "vitest";
import {
  PORTAL_THEME_IDS,
  PORTAL_THEMES,
  contrastRatio,
  ensureContrast,
  hueOf,
  mix,
  normalizeHex,
  portalAccent,
  readableOn,
  resolveThemeId,
  safeImageUrl,
  speedBars,
  themeVars,
} from "../src/lib/portal-themes";
import { formatDuration } from "../src/lib/duration";

// Brand colours an ISP might pick: very light, very dark, mid-tone, saturated, and the default.
const BRANDS = [
  "#facc15",
  "#0a2540",
  "#808080",
  "#e11d48",
  "#0ea5e9",
  "#16a34a",
  "#ffffff",
  "#000000",
  "#ff7a00",
];

describe("resolveThemeId", () => {
  it("accepts known ids and falls back to classic for anything else", () => {
    for (const id of PORTAL_THEME_IDS) expect(resolveThemeId(id)).toBe(id);
    for (const v of [undefined, null, "", "neon", "CLASSIC", 5, "classic; x"])
      expect(resolveThemeId(v)).toBe("classic");
  });
});

describe("colour helpers", () => {
  it("normalizes hex and rejects anything that is not a colour", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("0EA5E9")).toBe("#0ea5e9");
    for (const bad of [
      "red",
      "#12",
      "#12345g",
      "url(x)",
      "#fff; background:url(//evil)",
      "",
      null,
      undefined,
    ]) {
      expect(normalizeHex(bad as string)).toBe("#0ea5e9");
    }
  });
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
  it("mixes colours", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#123456", "#ffffff", 0)).toBe("#123456");
  });
  it("picks readable text on any fill", () => {
    expect(readableOn("#ffffff")).not.toBe("#ffffff");
    expect(readableOn("#000000")).toBe("#ffffff");
    for (const b of BRANDS) expect(contrastRatio(b, readableOn(b))).toBeGreaterThanOrEqual(4.2);
  });
  it("ensureContrast lifts a dark brand on a dark surface and leaves good colours alone", () => {
    const lifted = ensureContrast("#0a2540", "#162636", 3);
    expect(contrastRatio(lifted, "#162636")).toBeGreaterThanOrEqual(3);
    expect(ensureContrast("#facc15", "#162636", 3)).toBe("#facc15");
  });
  it("lifts a dark brand without losing its hue", () => {
    const lifted = ensureContrast("#0a2540", "#162636", 3);
    expect(Math.abs(hueOf(lifted) - hueOf("#0a2540"))).toBeLessThan(8);
    expect(lifted).not.toBe("#ffffff");
  });
  it("only allows http(s) image urls", () => {
    expect(safeImageUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    for (const bad of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,AAA",
      'https://x.com/a.jpg"onerror="x',
      "//x.com/a.jpg",
      "",
      null,
    ]) {
      expect(safeImageUrl(bad as string)).toBeNull();
    }
  });
});

describe("themeVars", () => {
  it("only ever emits custom properties, and never echoes the brand input", () => {
    for (const id of PORTAL_THEME_IDS) {
      const vars = themeVars(id, "#fff; background:url(//evil.example/x)");
      for (const [k, v] of Object.entries(vars)) {
        expect(k.startsWith("--")).toBe(true);
        expect(v).not.toContain("evil");
        // Everything is a hex colour, a length, a var() reference, or a constant font stack.
        const ok =
          /^(#[0-9a-f]{6}|[\d.]+(rem|px)|var\(--[a-z-]+\))$/.test(v) || k.startsWith("--pt-font");
        expect(ok, `${id} ${k}: ${v}`).toBe(true);
      }
    }
  });
  it("classic changes only the accent, so existing portals keep their surfaces", () => {
    expect(Object.keys(themeVars("classic", "#0ea5e9")).sort()).toEqual(
      ["--pt-accent", "--pt-on-accent", "--primary", "--primary-foreground", "--ring"].sort(),
    );
    // The default blue keeps the white button text portals always had.
    expect(themeVars("classic", "#0ea5e9")["--primary-foreground"]).toBe("#ffffff");
    // A very light brand colour no longer gets unreadable white text.
    expect(themeVars("classic", "#facc15")["--primary-foreground"]).not.toBe("#ffffff");
  });
  it("every theme keeps text readable for every brand colour (WCAG AA for body text)", () => {
    for (const id of PORTAL_THEME_IDS.filter((t) => t !== "classic")) {
      for (const brand of BRANDS) {
        const v = themeVars(id, brand);
        const label = `${id} / ${brand}`;
        expect(
          contrastRatio(v["--foreground"]!, v["--background"]!),
          `${label} text on page`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(v["--muted-foreground"]!, v["--background"]!),
          `${label} muted on page`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(v["--card-foreground"]!, v["--card"]!),
          `${label} text on card`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(v["--muted-foreground"]!, v["--card"]!),
          `${label} muted on card`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(v["--muted-foreground"]!, v["--muted"]!),
          `${label} muted on muted`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(v["--pt-on-accent"]!, v["--pt-accent"]!),
          `${label} text on accent`,
        ).toBeGreaterThanOrEqual(4.2);
      }
    }
  });
  it("the midnight accent stands out from its dark card for any brand colour", () => {
    for (const brand of BRANDS) {
      const v = themeVars("midnight", brand);
      expect(contrastRatio(v["--pt-accent"]!, v["--card"]!)).toBeGreaterThanOrEqual(3);
    }
  });
  it("portalAccent matches the theme's accent variable", () => {
    expect(portalAccent("block", "#e11d48")).toBe("#e11d48");
    expect(portalAccent("midnight", "#0a2540")).toBe(
      themeVars("midnight", "#0a2540")["--pt-accent"],
    );
  });
});

describe("theme definitions", () => {
  it("has a definition for every id, and only Lite avoids images", () => {
    for (const id of PORTAL_THEME_IDS) expect(PORTAL_THEMES[id].id).toBe(id);
    expect(PORTAL_THEME_IDS.filter((id) => !PORTAL_THEMES[id].usesImages)).toEqual(["lite"]);
  });
});

describe("plan formatting", () => {
  it("maps speed to 0-4 bars", () => {
    expect(speedBars(null)).toBe(0);
    expect(speedBars(512)).toBe(1);
    expect(speedBars(2000)).toBe(1);
    expect(speedBars(5000)).toBe(2);
    expect(speedBars(10000)).toBe(3);
    expect(speedBars(20000)).toBe(4);
  });
  it("uses singular units for 1", () => {
    expect(formatDuration(1, "hours")).toBe("1 hour");
    expect(formatDuration(3, "hours")).toBe("3 hours");
    expect(formatDuration(1, "day")).toBe("1 day");
    expect(formatDuration(null, "days")).toBe("");
  });
});
