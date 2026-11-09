import { describe, expect, it } from "vitest";
import {
  DISALLOWED_PATHS,
  FALLBACK_ORIGIN,
  OG_IMAGE,
  PUBLIC_PAGES,
  absoluteUrl,
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdScript,
  noindexHead,
  ogImageMeta,
  pageHead,
  resolveOrigin,
  robotsTxt,
  sitemapXml,
} from "../src/lib/seo";

const ORIGIN = "https://netgrid.example";

describe("resolveOrigin", () => {
  it("prefers the configured address, then the request's, then the fallback", () => {
    expect(resolveOrigin("https://pinned.example/", "https://req.example")).toBe(
      "https://pinned.example",
    );
    expect(resolveOrigin(undefined, "https://req.example/")).toBe("https://req.example");
    expect(resolveOrigin("", null)).toBe(FALLBACK_ORIGIN);
  });
  it("ignores anything that is not an http(s) address", () => {
    for (const bad of [
      "netgrid.example",
      "javascript:alert(1)",
      'https://x"y',
      "ftp://x.example",
      "https://a b",
    ]) {
      expect(resolveOrigin(bad, null)).toBe(FALLBACK_ORIGIN);
      expect(resolveOrigin(bad, "https://req.example")).toBe("https://req.example");
    }
  });
  it("drops trailing slashes and builds absolute URLs", () => {
    expect(resolveOrigin("https://x.example///")).toBe("https://x.example");
    expect(absoluteUrl("/", ORIGIN)).toBe(`${ORIGIN}/`);
    expect(absoluteUrl("/pppoe-billing", ORIGIN)).toBe(`${ORIGIN}/pppoe-billing`);
    expect(absoluteUrl("og.png", ORIGIN)).toBe(`${ORIGIN}/og.png`);
  });
});

describe("public page registry", () => {
  it("has the home page and unique, well-formed paths", () => {
    const paths = PUBLIC_PAGES.map((p) => p.path);
    expect(paths).toContain("/");
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p).toMatch(/^\/([a-z0-9-]+)?$/);
  });
  it("keeps every title and description a length search engines show in full", () => {
    for (const p of PUBLIC_PAGES) {
      expect(p.title.length, `${p.path} title`).toBeGreaterThanOrEqual(20);
      expect(p.title.length, `${p.path} title`).toBeLessThanOrEqual(60);
      expect(p.description.length, `${p.path} description`).toBeGreaterThanOrEqual(70);
      expect(p.description.length, `${p.path} description`).toBeLessThanOrEqual(160);
    }
  });
  it("never repeats a title or a description (duplicates compete with each other)", () => {
    expect(new Set(PUBLIC_PAGES.map((p) => p.title)).size).toBe(PUBLIC_PAGES.length);
    expect(new Set(PUBLIC_PAGES.map((p) => p.description)).size).toBe(PUBLIC_PAGES.length);
  });
});

describe("pageHead", () => {
  it("emits an indexable page with an ABSOLUTE canonical, social cards and matching titles", () => {
    const head = pageHead("/pppoe-billing", ORIGIN);
    const get = (k: string, v: string) => head.meta.find((m) => m[k] === v);
    const page = PUBLIC_PAGES.find((p) => p.path === "/pppoe-billing")!;
    expect(head.meta[0]).toEqual({ title: page.title });
    expect(get("name", "description")?.content).toBe(page.description);
    expect(get("name", "robots")?.content).toMatch(/^index, follow/);
    expect(get("property", "og:url")?.content).toBe(`${ORIGIN}/pppoe-billing`);
    expect(get("property", "og:title")?.content).toBe(page.title);
    expect(get("name", "twitter:title")?.content).toBe(page.title);
    expect(head.links).toEqual([{ rel: "canonical", href: `${ORIGIN}/pppoe-billing` }]);
  });
  it("uses the origin it is given, so every domain canonicalises to itself", () => {
    expect(pageHead("/", "https://a.example").links?.[0]?.href).toBe("https://a.example/");
    expect(pageHead("/", "https://b.example").links?.[0]?.href).toBe("https://b.example/");
  });
  it("matches the sitemap entry for the same page", () => {
    expect(sitemapXml(ORIGIN)).toContain(`<loc>${pageHead("/", ORIGIN).links![0]!.href}</loc>`);
  });
  it("refuses a path that is not a registered public page", () => {
    expect(() => pageHead("/tenant", ORIGIN)).toThrow();
  });
  it("attaches structured data as JSON-LD scripts", () => {
    const head = pageHead("/", ORIGIN, [breadcrumbJsonLd(ORIGIN, [{ name: "Home", path: "/" }])]);
    expect(head.scripts).toHaveLength(1);
    expect(head.scripts![0]!.type).toBe("application/ld+json");
    expect(JSON.parse(head.scripts![0]!.children)["@type"]).toBe("BreadcrumbList");
  });
});

describe("noindexHead and social image", () => {
  it("keeps a page out of search results and has no canonical or social tags", () => {
    const head = noindexHead("Sign in");
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(head.meta[0]).toEqual({ title: "Sign in · NetGrid" });
    expect(head.links).toBeUndefined();
  });
  it("serves the social card from this site, as an absolute URL with its size", () => {
    const tags = ogImageMeta(ORIGIN);
    const og = tags.find((t) => t.property === "og:image")!;
    expect(og.content).toBe(`${ORIGIN}${OG_IMAGE.path}`);
    expect(tags.find((t) => t.name === "twitter:image")!.content).toBe(og.content);
    expect(tags.find((t) => t.property === "og:image:width")!.content).toBe("1200");
    expect(tags.find((t) => t.property === "og:image:height")!.content).toBe("630");
    expect(tags.every((t) => !JSON.stringify(t).includes("googleapis"))).toBe(true);
  });
});

describe("JSON-LD", () => {
  it("cannot be broken out of its <script> tag by content", () => {
    const evil = faqJsonLd([{ q: "</script><script>alert(1)</script>", a: "a < b" }]);
    const script = jsonLdScript(evil);
    expect(script.children).not.toContain("</script>");
    expect(script.children).not.toContain("<");
    expect(JSON.parse(script.children)).toEqual(evil); // ...and still decodes to the original
  });
  it("builds breadcrumb positions from 1 with absolute URLs", () => {
    const b = breadcrumbJsonLd(ORIGIN, [
      { name: "Home", path: "/" },
      { name: "PPPoE", path: "/pppoe-billing" },
    ]);
    expect(b.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    expect(b.itemListElement[1]!.item).toBe(`${ORIGIN}/pppoe-billing`);
  });
  it("builds FAQPage with a Question per entry", () => {
    const f = faqJsonLd([
      { q: "One?", a: "Yes." },
      { q: "Two?", a: "No." },
    ]);
    expect(f["@type"]).toBe("FAQPage");
    expect(f.mainEntity.map((e) => e.name)).toEqual(["One?", "Two?"]);
    expect(f.mainEntity[0]!.acceptedAnswer.text).toBe("Yes.");
  });
});

describe("robots.txt", () => {
  const robots = robotsTxt(ORIGIN);
  it("blocks machine endpoints and signed-in consoles but not the public site", () => {
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    for (const p of ["/api/", "/tenant", "/super-admin", "/portal"])
      expect(robots).toContain(`Disallow: ${p}`);
    expect(DISALLOWED_PATHS).toContain("/api/"); // router setup URLs carry tokens
  });
  it("does not block any page in the sitemap", () => {
    for (const page of PUBLIC_PAGES) {
      for (const blocked of DISALLOWED_PATHS) {
        expect(page.path.startsWith(blocked), `${page.path} vs ${blocked}`).toBe(false);
      }
    }
  });
  it("points at the sitemap on the same origin", () => {
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
});

describe("sitemap.xml", () => {
  const xml = sitemapXml(ORIGIN);
  it("is well-formed and lists exactly the public pages", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(PUBLIC_PAGES.map((p) => absoluteUrl(p.path, ORIGIN)));
  });
  it("never lists a private area", () => {
    for (const loc of [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)) {
      for (const blocked of DISALLOWED_PATHS) expect(loc.includes(blocked)).toBe(false);
    }
  });
  it("escapes characters that are special in XML", () => {
    const x = sitemapXml(ORIGIN, [
      { path: "/a&b", title: "t", description: "d", changefreq: "weekly", priority: 0.5 },
    ]);
    expect(x).toContain("/a&amp;b</loc>");
  });
});
