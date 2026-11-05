import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const sitemapUrl = new URL("/sitemap.xml", request.url).href;
        const body = [
          "User-agent: *",
          "Allow: /",
          "Disallow: /api/",
          `Sitemap: ${sitemapUrl}`,
          "",
        ].join("\n");
        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
