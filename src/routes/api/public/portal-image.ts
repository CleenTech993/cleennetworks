import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PORTAL_IMAGE_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/i;
const IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export const Route = createFileRoute("/api/public/portal-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const path = new URL(request.url).searchParams.get("path");
        if (!path || !PORTAL_IMAGE_PATH.test(path))
          return new Response("Not found", { status: 404 });

        const { data, error } = await supabaseAdmin.storage.from("portal-assets").download(path);
        if (error || !data) {
          if (error) console.error("Captive portal image retrieval failed", error);
          return new Response("Image unavailable", {
            status: error?.status === 404 ? 404 : 502,
          });
        }

        const contentType = data.type.split(";")[0]?.trim().toLowerCase();
        if (!contentType || !IMAGE_TYPES.has(contentType))
          return new Response("Unsupported image type", { status: 415 });

        return new Response(data, {
          headers: {
            "cache-control": "public, max-age=31536000, immutable",
            "content-length": String(data.size),
            "content-type": contentType,
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
