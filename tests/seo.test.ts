import { describe, expect, it } from "vitest";
import { call } from "./helpers/call";
import { PUBLIC_PAGES } from "../src/lib/seo";

import { Route as RobotsRoute } from "../src/routes/robots[.]txt";
import { Route as SitemapRoute } from "../src/routes/sitemap[.]xml";

describe("public SEO resources", () => {
  it("publishes a host-aware sitemap of the public marketing pages", async () => {
    const response = await call(SitemapRoute, "GET", {
      url: "https://netgrid.example/sitemap.xml",
    });
    const xml = await response.text();

    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(xml).toContain("<loc>https://netgrid.example/</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(PUBLIC_PAGES.length);
    for (const page of PUBLIC_PAGES) {
      expect(xml).toContain(`<loc>https://netgrid.example${page.path}</loc>`);
    }
    // Private areas never appear.
    expect(xml).not.toMatch(/\/(tenant|super-admin|portal|api|login|signup)/);
  });

  it("points crawlers at the sitemap and excludes API endpoints", async () => {
    const response = await call(RobotsRoute, "GET", {
      url: "https://netgrid.example/robots.txt",
    });
    const text = await response.text();

    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(text).toContain("Disallow: /api/");
    for (const p of ["/tenant", "/super-admin", "/portal"])
      expect(text).toContain(`Disallow: ${p}`);
    expect(text).toContain("Sitemap: https://netgrid.example/sitemap.xml");
  });
});
