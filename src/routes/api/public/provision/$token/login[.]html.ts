import { createFileRoute } from "@tanstack/react-router";
import { getRequestHost } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildLoginHtml } from "@/lib/hotspot-login.server";
import { authenticateRouter } from "@/lib/router-auth.server";
import { tooManyRequests } from "@/lib/rate-limit.server";

// Served to the router itself (/tool fetch) and saved as the hotspot login.html.
// Authenticated by the router's provision token, like the other provisioning routes.
export const Route = createFileRoute("/api/public/provision/$token/login.html")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const auth = await authenticateRouter(request, params.token);
        if (!auth.ok)
          return auth.blocked
            ? tooManyRequests()
            : new Response("unknown token\n", { status: 404 });
        const router = auth.router;

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("slug")
          .eq("id", router.tenant_id)
          .single();
        if (!tenant?.slug) return new Response("portal not configured\n", { status: 404 });

        const portalUrl = `https://${getRequestHost()}/p/${encodeURIComponent(tenant.slug)}`;
        const html = buildLoginHtml({ portalUrl, routerId: router.id });

        // text/plain so CDN/edge HTML rewriting can't alter the bytes the router stores.
        return new Response(html, {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
