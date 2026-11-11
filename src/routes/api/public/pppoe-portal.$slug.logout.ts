import { createFileRoute } from "@tanstack/react-router";
import { clearPppoePortalCookie } from "@/lib/pppoe-portal.server";

export const Route = createFileRoute("/api/public/pppoe-portal/$slug/logout")({
  server: {
    handlers: {
      POST: async ({ params }) =>
        Response.json(
          { ok: true },
          {
            headers: {
              "set-cookie": clearPppoePortalCookie(params.slug),
              "cache-control": "no-store",
            },
          },
        ),
    },
  },
});
