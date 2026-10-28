import { describe, expect, it } from "vitest";
import {
  DISALLOWED_PATHS,
  PUBLIC_PAGES,
  SITE_URL,
  absoluteUrl,
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdScript,
  noindexHead,
  pageHead,
  resolveSiteUrl,
  robotsTxt,
  sitemapXml,
} from "../src/lib/seo";

describe("site address", () => {
  it("uses a valid configured address, drops trailing slashes, and falls back otherwise", () => {
    expect(resolveSiteUrl("https://netgrid.example/")).toBe("https://netgrid.example");
    expect(resolveSiteUrl("https://netgrid.example///")).toBe("https://netgrid.example");
    for (const bad of [
      undefined,
      null,
      "",
      "netgrid.example",
      "javascript:alert(1)",
      'https://x"y',
    ]) {
      expect(resolveSiteUrl(bad)).toBe("https://cleennetworks.lovable.app");
    }
  });
  it("builds absolute URLs", () => {
    expect(absoluteUrl("/")).toBe(`${SITE_URL}/`);
    expect(absoluteUrl("/pppoe-billing")).toBe(`${SITE_URL}/pppoe-billing`);
    expect(absoluteUrl("og.png")).toBe(`${SITE_URL}/og.png`);
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
      expect(p.title.length, `${p.path} title`).toBeLessThanOrEqual(60);
      expect(p.title.length, `${p.path} title`).toBeGreaterThanOrEqual(20);
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
  it("emits an indexable page with canonical, social cards and matching titles", () => {
    const head = pageHead("/pppoe-billing");
    const get = (k: string, v: string) => head.meta.find((m) => m[k] === v);
    const page = PUBLIC_PAGES.find((p) => p.path === "/pppoe-billing")!;
    expect(head.meta[0]).toEqual({ title: page.title });
    expect(get("name", "description")?.content).toBe(page.description);
    expect(get("name", "robots")?.content).toMatch(/^index, follow/);
    expect(get("property", "og:url")?.content).toBe(`${SITE_URL}/pppoe-billing`);
    expect(get("property", "og:title")?.content).toBe(page.title);
    expect(get("name", "twitter:title")?.content).toBe(page.title);
    expect(head.links).toEqual([{ rel: "canonical", href: `${SITE_URL}/pppoe-billing` }]);
  });
  it("gives the home page a canonical with a trailing slash that matches the sitemap", () => {
    expect(pageHead("/").links?.[0]?.href).toBe(`${SITE_URL}/`);
    expect(sitemapXml()).toContain(`<loc>${SITE_URL}/</loc>`);
  });
  it("refuses a path that is not a registered public page", () => {
    expect(() => pageHead("/tenant")).toThrow();
  });
  it("attaches structured data as JSON-LD scripts", () => {
    const head = pageHead("/", [breadcrumbJsonLd([{ name: "Home", path: "/" }])]);
    expect(head.scripts).toHaveLength(1);
    expect(head.scripts![0]!.type).toBe("application/ld+json");
    expect(JSON.parse(head.scripts![0]!.children)["@type"]).toBe("BreadcrumbList");
  });
});

describe("noindexHead", () => {
  it("keeps a page out of search results and has no canonical or social tags", () => {
    const head = noindexHead("Sign in");
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(head.meta[0]).toEqual({ title: "Sign in · NetGrid" });
    expect(head.links).toBeUndefined();
  });
});

describe("JSON-LD", () => {
  it("cannot be broken out of its <script> tag by content", () => {
    const evil = faqJsonLd([{ q: "</script><script>alert(1)</script>", a: "a < b" }]);
    const script = jsonLdScript(evil);
    expect(script.children).not.toContain("</script>");
    expect(script.children).not.toContain("<");
    // ...and still decodes to exactly the original data.
    expect(JSON.parse(script.children)).toEqual(evil);
  });
  it("builds breadcrumb positions from 1 with absolute URLs", () => {
    const b = breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: "PPPoE", path: "/pppoe-billing" },
    ]);
    expect(b.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    expect(b.itemListElement[1]!.item).toBe(`${SITE_URL}/pppoe-billing`);
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
  const robots = robotsTxt();
  it("blocks machine endpoints and signed-in consoles but not the public site", () => {
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    for (const p of ["/api/", "/tenant", "/super-admin", "/portal"])
      expect(robots).toContain(`Disallow: ${p}`);
    // Router setup URLs carry tokens: they must never be crawlable.
    expect(DISALLOWED_PATHS).toContain("/api/");
  });
  it("does not block any page in the sitemap", () => {
    for (const page of PUBLIC_PAGES) {
      for (const blocked of DISALLOWED_PATHS) {
        expect(page.path.startsWith(blocked), `${page.path} vs ${blocked}`).toBe(false);
      }
    }
  });
  it("points at the sitemap by absolute URL", () => {
    expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });
});

describe("sitemap.xml", () => {
  const xml = sitemapXml();
  it("is well-formed and lists exactly the public pages", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(PUBLIC_PAGES.map((p) => absoluteUrl(p.path)));
    expect(xml.match(/<url>/g)).toHaveLength(PUBLIC_PAGES.length);
  });
  it("only ever lists absolute URLs, never private areas", () => {
    for (const loc of [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)) {
      expect(loc.startsWith("https://") || loc.startsWith("http://")).toBe(true);
      for (const blocked of DISALLOWED_PATHS) expect(loc.includes(blocked)).toBe(false);
    }
  });
  it("escapes characters that are special in XML", () => {
    const x = sitemapXml([
      { path: "/a&b", title: "t", description: "d", changefreq: "weekly", priority: 0.5 },
    ]);
    expect(x).toContain("/a&amp;b</loc>");
    expect(x).not.toContain("/a&b<");
  });
});
