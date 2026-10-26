import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { authenticateRouter } from "@/lib/router-auth.server";
import { parsePppoeReport } from "@/lib/pppoe-sessions";

// PPPoE session report pushed by the router every 2 minutes (see buildPppoeAgentLines).
// Body: records "username|mac|ip" separated by ";".
//
// The MAC is the session's caller-id. It is stored on the client so the console can show it and
// whether the client is connected. Only clients that belong to THIS router (or are still
// unassigned) are updated: a credential showing up on a router it is not assigned to is ignored.
export const Route = createFileRoute("/api/public/router/pppoe/$token")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        // Authenticate before reading the body so anonymous callers cannot make us buffer uploads.
        const auth = await authenticateRouter(request, params.token);
        if (!auth.ok)
          return auth.blocked ? tooManyRequests() : new Response("unknown", { status: 404 });
        const router = auth.router;
        if (!rateLimit(`pppoe:${router.id}`, 30, 60_000)) return tooManyRequests();

        const body = (await request.text()).slice(0, 128_000);
        const sessions = parsePppoeReport(body);
        if (!sessions.length) return new Response("ok");

        const { error } = await supabaseAdmin.rpc("record_pppoe_sessions", {
          p_router_id: router.id,
          p_tenant_id: router.tenant_id,
          p_sessions: sessions.map((s) => ({ username: s.username, mac: s.mac, ip: s.ip })),
        });
        if (error) {
          console.error("pppoe report failed", error);
          return new Response("error", { status: 500 });
        }
        return new Response("ok");
      },
    },
  },
});
