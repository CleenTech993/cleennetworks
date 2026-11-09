// SEO in one place: which pages are public, how each is described to search engines and social
// networks, and the robots.txt / sitemap.xml generators. Pure functions (no DOM or server access)
// so they are unit-testable; the site's address is always passed in.
//
// The sitemap, the canonical tags and the tests all read PUBLIC_PAGES, so they cannot disagree.

export const SITE_NAME = "NetGrid";

// Used only when neither VITE_SITE_URL nor the incoming request says where the site lives.
export const FALLBACK_ORIGIN = "https://cleennetworks.lovable.app";

/**
 * The address search engines should treat as the real one: VITE_SITE_URL when set (pin it once a
 * custom domain exists, so previews and mirrors canonicalise to it), otherwise the address the
 * request came in on, otherwise the fallback. Always without a trailing slash.
 */
export function resolveOrigin(
  configured: string | undefined | null,
  requestOrigin?: string | null,
): string {
  const valid = (v: string | undefined | null) =>
    v && /^https?:\/\/[^\s"'<>]+$/i.test(v.trim()) ? v.trim().replace(/\/+$/, "") : null;
  return valid(configured) ?? valid(requestOrigin) ?? FALLBACK_ORIGIN;
}

/** "/pricing" -> "https://example.com/pricing"; "/" -> "https://example.com/". */
export function absoluteUrl(path: string, origin: string): string {
  return origin + (path.startsWith("/") ? path : `/${path}`);
}

export const OG_IMAGE = {
  path: "/og.png",
  width: 1200,
  height: 630,
  alt: "NetGrid: your network, one clear view",
} as const;

/** Social-card image tags (absolute URLs, served from this site rather than a third party). */
export function ogImageMeta(origin: string): Record<string, string>[] {
  const url = absoluteUrl(OG_IMAGE.path, origin);
  return [
    { property: "og:image", content: url },
    { property: "og:image:width", content: String(OG_IMAGE.width) },
    { property: "og:image:height", content: String(OG_IMAGE.height) },
    { property: "og:image:alt", content: OG_IMAGE.alt },
    { name: "twitter:image", content: url },
    { name: "twitter:image:alt", content: OG_IMAGE.alt },
  ];
}

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
    title: "ISP Management Software for MikroTik | NetGrid",
    description:
      "Manage a hotspot or PPPoE ISP with MikroTik provisioning, M-Pesa payments, and live router monitoring in one platform.",
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
      "Customers pay for internet with an M-Pesa prompt on their phone and get online straight away. Each payment is confirmed with Safaricom before access.",
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

/** Head tags for an indexable page: title, description, absolute canonical, social cards, JSON-LD. */
export function pageHead(path: string, origin: string, jsonLd: unknown[] = []): HeadTags {
  const page = pageByPath(path);
  const url = absoluteUrl(page.path, origin);
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

export function organizationJsonLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: absoluteUrl("/", origin),
    logo: absoluteUrl("/pwa-icon-512.png", origin),
  };
}

export function websiteJsonLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl("/", origin),
  };
}

export function softwareJsonLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: absoluteUrl("/", origin),
    description: pageByPath("/").description,
  };
}

export function breadcrumbJsonLd(origin: string, trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: absoluteUrl(t.path, origin),
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

export function robotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    ...DISALLOWED_PATHS.map((p) => `Disallow: ${p}`),
    `Sitemap: ${absoluteUrl("/sitemap.xml", origin)}`,
    "",
  ].join("\n");
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function sitemapXml(origin: string, pages: PublicPage[] = PUBLIC_PAGES): string {
  const urls = pages
    .map(
      (p) =>
        `  <url>\n    <loc>${xml(absoluteUrl(p.path, origin))}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority.toFixed(1)}</priority>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
