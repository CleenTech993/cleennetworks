import { createFileRoute } from "@tanstack/react-router";
import { resolveOrigin, sitemapXml } from "@/lib/seo";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(
          sitemapXml(resolveOrigin(import.meta.env.VITE_SITE_URL, new URL(request.url).origin)),
          {
            headers: {
              "content-type": "application/xml; charset=utf-8",
              "cache-control": "public, max-age=3600",
            },
          },
        ),
    },
  },
});
