import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { equalHash, hashRouterSupportPassword } from "@/lib/router-support.server";

const PasswordSchema = z.object({ password: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const NO_STORE = {
  "cache-control": "no-store, private",
  "x-robots-tag": "noindex, nofollow",
};

export const Route = createFileRoute("/api/public/router-support-sessions/$sessionId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.sessionId)) return new Response("Not found", { status: 404 });
        const key = `router-support-login:${params.sessionId}:${clientIp(request)}`;
        if (!rateLimit(key, 5, 60_000)) return tooManyRequests();

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid support credentials." }, { status: 401, headers: NO_STORE });
        }
        const parsed = PasswordSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "Invalid support credentials." }, { status: 401, headers: NO_STORE });
        }

        const { data: session } = await supabaseAdmin
          .from("router_support_sessions")
          .select("id,password_hash,expires_at,revoked_at")
          .eq("id", params.sessionId)
          .maybeSingle();
        if (
          !session ||
          session.revoked_at ||
          Date.parse(session.expires_at) <= Date.now() ||
          !equalHash(session.password_hash, await hashRouterSupportPassword(parsed.data.password))
        ) {
          return Response.json({ error: "Invalid or expired support session." }, { status: 401, headers: NO_STORE });
        }

        const maxAge = Math.max(1, Math.floor((Date.parse(session.expires_at) - Date.now()) / 1000));
        const cookieName = `ng_support_${session.id}`;
        return new Response(null, {
          status: 204,
          headers: {
            ...NO_STORE,
            "set-cookie": `${cookieName}=${parsed.data.password}; Path=/api/public/router-support-sessions/${session.id}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`,
          },
        });
      },
      GET: async ({ request, params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.sessionId)) return new Response("Not found", { status: 404 });
        const key = `router-support-data:${params.sessionId}:${clientIp(request)}`;
        if (!rateLimit(key, 30, 60_000)) return tooManyRequests();

        const cookieName = `ng_support_${params.sessionId}=`;
        const password = (request.headers.get("cookie") ?? "")
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(cookieName))
          ?.slice(cookieName.length);
        if (!password || !/^[A-Za-z0-9_-]{43}$/.test(password)) {
          return Response.json({ error: "Sign in to this support session." }, { status: 401, headers: NO_STORE });
        }

        const { data: session } = await supabaseAdmin
          .from("router_support_sessions")
          .select("id,tenant_id,router_id,password_hash,expires_at,revoked_at,access_count")
          .eq("id", params.sessionId)
          .maybeSingle();
        if (
          !session ||
          session.revoked_at ||
          Date.parse(session.expires_at) <= Date.now() ||
          !equalHash(session.password_hash, await hashRouterSupportPassword(password))
        ) {
          return Response.json({ error: "This support session has expired or was revoked." }, { status: 401, headers: NO_STORE });
        }

        const [{ data: router, error: routerError }, { data: metrics }] = await Promise.all([
          supabaseAdmin
            .from("routers")
            .select("name,status,last_heartbeat_at,cpu_load,free_memory_mb,total_memory_mb,uptime_seconds,temperature,voltage")
            .eq("id", session.router_id)
            .eq("tenant_id", session.tenant_id)
            .maybeSingle(),
          supabaseAdmin
            .from("router_metrics")
            .select("ts,cpu_pct,mem_pct,wan_latency_ms,wan_loss_pct")
            .eq("router_id", session.router_id)
            .eq("tenant_id", session.tenant_id)
            .order("ts", { ascending: false })
            .limit(12),
        ]);
        if (routerError || !router) return new Response("Not found", { status: 404, headers: NO_STORE });

        await supabaseAdmin
          .from("router_support_sessions")
          .update({ last_accessed_at: new Date().toISOString(), access_count: session.access_count + 1 })
          .eq("id", session.id)
          .is("revoked_at", null);

        const lastHeartbeat = router.last_heartbeat_at ? Date.parse(router.last_heartbeat_at) : 0;
        return Response.json(
          {
            router: {
              name: router.name,
              status: lastHeartbeat && Date.now() - lastHeartbeat < 3 * 60_000 ? "online" : "offline",
              lastSeenAt: router.last_heartbeat_at,
              cpuLoad: router.cpu_load,
              memoryUsedPct:
                router.total_memory_mb && router.free_memory_mb != null
                  ? Math.round(((router.total_memory_mb - router.free_memory_mb) / router.total_memory_mb) * 100)
                  : null,
              uptimeSeconds: router.uptime_seconds,
              temperature: router.temperature,
              voltage: router.voltage,
            },
            metrics: metrics ?? [],
            expiresAt: session.expires_at,
          },
          { headers: NO_STORE },
        );
      },
    },
  },
});