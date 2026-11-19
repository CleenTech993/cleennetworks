import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { normalizeMac } from "@/lib/devices";

const RECENT_REPORT_MS = 2 * 60_000;

export const Route = createFileRoute("/api/public/portal/$slug/session")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!rateLimit(`portal-session:${params.slug}:${clientIp(request)}`, 30, 60_000))
          return tooManyRequests();

        const url = new URL(request.url);
        const mac = normalizeMac(url.searchParams.get("mac") ?? "");
        const routerId = url.searchParams.get("routerId") ?? "";
        if (!mac || !/^[0-9a-f-]{36}$/i.test(routerId))
          return Response.json(
            { error: "Valid device and site details are required." },
            { status: 400 },
          );

        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", params.slug)
          .maybeSingle();
        if (tenantError) {
          console.error("Portal session tenant lookup failed", tenantError);
          return Response.json({ error: "Could not check the router session." }, { status: 503 });
        }
        if (!tenant) return Response.json({ error: "Portal not found." }, { status: 404 });

        const { data: router, error: routerError } = await supabaseAdmin
          .from("routers")
          .select("id")
          .eq("id", routerId)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (routerError) {
          console.error("Portal session router lookup failed", routerError);
          return Response.json({ error: "Could not check the router session." }, { status: 503 });
        }
        if (!router) return Response.json({ error: "Invalid site." }, { status: 404 });

        const { data: device, error: deviceError } = await supabaseAdmin
          .from("router_devices")
          .select("authorized,last_seen_at")
          .eq("tenant_id", tenant.id)
          .eq("router_id", router.id)
          .eq("mac", mac)
          .maybeSingle();
        if (deviceError) {
          console.error("Portal session device lookup failed", deviceError);
          return Response.json({ error: "Could not check the router session." }, { status: 503 });
        }

        const lastSeen = device ? Date.parse(device.last_seen_at) : Number.NaN;
        const fresh =
          Number.isFinite(lastSeen) &&
          lastSeen <= Date.now() + 30_000 &&
          Date.now() - lastSeen <= RECENT_REPORT_MS;
        return Response.json(
          { active: Boolean(device?.authorized && fresh) },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
