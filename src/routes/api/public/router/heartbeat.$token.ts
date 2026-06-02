import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/router/heartbeat/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
        await supabaseAdmin
          .from("routers")
          .update({
            status: "online",
            last_seen_at: new Date().toISOString(),
            public_ip: ip,
          })
          .eq("provision_token", params.token);
        return new Response("ok", { headers: { "content-type": "text/plain" } });
      },
    },
  },
});
