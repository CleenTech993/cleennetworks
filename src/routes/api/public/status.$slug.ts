import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { LIVE_WINDOW_MS } from "@/lib/router-health";
import { publicNetworkStatus } from "@/lib/public-network-status";
import { z } from "zod";

const SlugSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i);
const PUBLIC_CACHE = "public, max-age=30, stale-while-revalidate=30";

export const Route = createFileRoute("/api/public/status/$slug")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const slug = SlugSchema.safeParse(params.slug);
        if (!slug.success) return new Response("Not found", { status: 404 });

        if (!rateLimit(`public-status:${clientIp(request)}`, 60, 60_000)) {
          return tooManyRequests();
        }

        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("id,name,public_status_enabled")
          .eq("slug", slug.data)
          .eq("public_status_enabled", true)
          .maybeSingle();
        if (tenantError) {
          console.error("Public network status tenant lookup failed", tenantError);
          return Response.json(
            { error: "Status is temporarily unavailable." },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
        if (!tenant) return new Response("Not found", { status: 404 });

        const now = new Date();
        const cutoff = new Date(now.getTime() - LIVE_WINDOW_MS).toISOString();
        const [totalResult, liveResult] = await Promise.all([
          supabaseAdmin
            .from("routers")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id)
            .neq("status", "pending"),
          supabaseAdmin
            .from("routers")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id)
            .neq("status", "pending")
            .or(
              `last_heartbeat_at.gte.${cutoff},and(last_heartbeat_at.is.null,last_seen_at.gte.${cutoff})`,
            ),
        ]);
        if (totalResult.error || liveResult.error) {
          console.error(
            "Public network status router summary failed",
            totalResult.error ?? liveResult.error,
          );
          return Response.json(
            { error: "Status is temporarily unavailable." },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }

        return Response.json(
          {
            name: tenant.name,
            status: publicNetworkStatus(totalResult.count ?? 0, liveResult.count ?? 0),
            updatedAt: now.toISOString(),
          },
          {
            headers: {
              "Cache-Control": PUBLIC_CACHE,
              "X-Content-Type-Options": "nosniff",
            },
          },
        );
      },
    },
  },
});
