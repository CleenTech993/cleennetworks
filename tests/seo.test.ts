import { describe, expect, it } from "vitest";
import { call } from "./helpers/call";

import { Route as RobotsRoute } from "../src/routes/robots[.]txt";
import { Route as SitemapRoute } from "../src/routes/sitemap[.]xml";

describe("public SEO resources", () => {
  it("publishes a host-aware sitemap with only the marketing homepage", async () => {
    const response = await call(SitemapRoute, "GET", {
      url: "https://netgrid.example/sitemap.xml",
    });
    const xml = await response.text();

    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(xml).toContain("<loc>https://netgrid.example/</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(1);
  });

  it("points crawlers at the sitemap and excludes API endpoints", async () => {
    const response = await call(RobotsRoute, "GET", {
      url: "https://netgrid.example/robots.txt",
    });
    const text = await response.text();

    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(text).toContain("Disallow: /api/");
    expect(text).toContain("Sitemap: https://netgrid.example/sitemap.xml");
  });
});
