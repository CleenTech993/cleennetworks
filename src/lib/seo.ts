// SEO in one place: the site's address, which pages are public, and how each is described to
// search engines and social networks. Pure functions (no DOM / server access) so they are testable.
//
// The sitemap, the canonical tags and the tests all read PUBLIC_PAGES, so they cannot disagree.

export const SITE_NAME = "NetGrid";

// The address search engines should treat as the real one. When a custom domain is attached,
// set VITE_SITE_URL (or change this) so canonical tags, the sitemap and social cards follow it.
const DEFAULT_SITE_URL = "https://cleennetworks.lovable.app";

export function resolveSiteUrl(raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  return (/^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : DEFAULT_SITE_URL).replace(/\/+$/, "");
}

export const SITE_URL = resolveSiteUrl(
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SITE_URL,
);

/** "/pricing" -> "https://example.com/pricing"; "/" -> "https://example.com/". */
export function absoluteUrl(path: string = "/"): string {
  return SITE_URL + (path.startsWith("/") ? path : `/${path}`);
}

export const OG_IMAGE = {
  path: "/og.png",
  width: 1200,
  height: 630,
  alt: "NetGrid: every router, voucher and payment in one place",
} as const;

// ---------------------------------------------------------------------------
// Public pages (the only ones that belong in search results)
// ---------------------------------------------------------------------------

export interface PublicPage {
  path: string;
  /** <title>. Keep under ~60 characters so it isn't cut off in results. */
  title: string;
  /** Meta description. Aim for 70-160 characters. */
  description: string;
  changefreq: "weekly" | "monthly";
  priority: number;
}

export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: "/",
    title: "NetGrid: run your ISP and hotspot business",
    description:
      "Set up MikroTik routers, sell hotspot and PPPoE packages through M-Pesa, and see which sites are online, all from one console.",
    changefreq: "weekly",
    priority: 1,
  },
  {
    path: "/mikrotik-hotspot-billing",
    title: "MikroTik hotspot billing with M-Pesa vouchers | NetGrid",
    description:
      "Sell Wi-Fi by the hour on MikroTik routers: a branded captive portal, M-Pesa checkout, printable vouchers and live router status. Set up with one command.",
    changefreq: "monthly",
    priority: 0.8,
  },
  {
    path: "/pppoe-billing",
    title: "PPPoE billing for home internet on MikroTik | NetGrid",
    description:
      "Manage monthly PPPoE subscribers on MikroTik: a speed and expiry for every package, each client's router and MAC, and access that ends when a plan does.",
    changefreq: "monthly",
    priority: 0.8,
  },
  {
    path: "/mpesa-wifi-payments",
    title: "Accept M-Pesa for Wi-Fi and internet packages | NetGrid",
    description:
      "Customers pay for internet with an M-Pesa prompt on their phone and get online straight away. Each payment is confirmed with the provider before access.",
    changefreq: "monthly",
    priority: 0.8,
  },
];

export function pageByPath(path: string): PublicPage {
  const page = PUBLIC_PAGES.find((p) => p.path === path);
  if (!page) throw new Error(`No public page registered for ${path}`);
  return page;
}

// ---------------------------------------------------------------------------
// Head tags
// ---------------------------------------------------------------------------

interface Meta {
  [key: string]: string;
}
interface Link {
  rel: string;
  href: string;
}
interface Script {
  type: string;
  children: string;
}
export interface HeadTags {
  meta: Meta[];
  links?: Link[];
  scripts?: Script[];
}

/** JSON-LD as a <script>. "<" is escaped so page data can never close the tag early. */
export function jsonLdScript(data: unknown): Script {
  return { type: "application/ld+json", children: JSON.stringify(data).replace(/</g, "\\u003c") };
}

/** Head tags for an indexable page: title, description, canonical, social cards, structured data. */
export function pageHead(path: string, jsonLd: unknown[] = []): HeadTags {
  const page = pageByPath(path);
  const url = absoluteUrl(page.path);
  return {
    meta: [
      { title: page.title },
      { name: "description", content: page.description },
      { name: "robots", content: "index, follow, max-image-preview:large" },
      { property: "og:title", content: page.title },
      { property: "og:description", content: page.description },
      { property: "og:url", content: url },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: page.title },
      { name: "twitter:description", content: page.description },
    ],
    links: [{ rel: "canonical", href: url }],
    scripts: jsonLd.map(jsonLdScript),
  };
}

/** Head tags for a page that must stay out of search results (sign-in, consoles, portals). */
export function noindexHead(title: string): HeadTags {
  return {
    meta: [{ title: `${title} · ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }],
  };
}

// ---------------------------------------------------------------------------
// Structured data (schema.org)
// ---------------------------------------------------------------------------

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    logo: absoluteUrl("/icon-512.png"),
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl("/"),
  };
}

export function softwareJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: absoluteUrl("/"),
    description: pageByPath("/").description,
  };
}

export function breadcrumbJsonLd(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: absoluteUrl(t.path),
    })),
  };
}

export interface Faq {
  q: string;
  a: string;
}

export function faqJsonLd(faqs: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

// ---------------------------------------------------------------------------
// robots.txt and sitemap.xml
// ---------------------------------------------------------------------------

// Machine endpoints (they carry router tokens) and the signed-in consoles. Sign-in and portal pages
// are kept out with a noindex tag instead, because a blocked page can't show search engines its tag.
export const DISALLOWED_PATHS = ["/api/", "/tenant", "/super-admin", "/portal"];

export function robotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    ...DISALLOWED_PATHS.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    "",
  ].join("\n");
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function sitemapXml(pages: PublicPage[] = PUBLIC_PAGES): string {
  const urls = pages
    .map(
      (p) =>
        `  <url>\n    <loc>${xml(absoluteUrl(p.path))}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority.toFixed(1)}</priority>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
