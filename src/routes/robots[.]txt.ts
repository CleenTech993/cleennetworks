import { createFileRoute } from "@tanstack/react-router";
import { resolveOrigin, robotsTxt } from "@/lib/seo";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(
          robotsTxt(resolveOrigin(import.meta.env.VITE_SITE_URL, new URL(request.url).origin)),
          {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "public, max-age=3600",
            },
          },
        ),
    },
  },
});
