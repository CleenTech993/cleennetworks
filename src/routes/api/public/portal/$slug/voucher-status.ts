import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { voucherReady } from "@/lib/voucher-ready";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Polled by the portal after a voucher is redeemed: has the customer's router received it yet?
//   GET /api/public/portal/<slug>/voucher-status?code=ABCD2345&router=<router id>
// The router only learns about a voucher on its next sync (about every 2 minutes), and logging the
// customer in before that fails. Answers { ready: true } when the router's last sync included it.
// When the router can't be identified there is nothing to wait for, so it says ready.
export const Route = createFileRoute("/api/public/portal/$slug/voucher-status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!rateLimit(`vstatus:${params.slug}:${clientIp(request)}`, 60, 60_000)) return tooManyRequests();

        const url = new URL(request.url);
        const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
        const routerId = url.searchParams.get("router");
        if (code.length < 4 || code.length > 40) return Response.json({ error: "Bad code" }, { status: 400 });

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", params.slug)
          .maybeSingle();
        if (!tenant) return Response.json({ error: "Portal not found" }, { status: 404 });

        const { data: v } = await supabaseAdmin
          .from("vouchers")
          .select("id,created_at")
          .eq("tenant_id", tenant.id)
          .eq("code", code)
          .maybeSingle();
        if (!v) return Response.json({ error: "Invalid voucher" }, { status: 404 });

        if (!routerId || !UUID.test(routerId)) return Response.json({ ready: true, known: false });

        const { data: router } = await supabaseAdmin
          .from("routers")
          .select("last_sync_at")
          .eq("id", routerId)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!router) return Response.json({ ready: true, known: false });

        const ready = voucherReady({ voucherCreatedAt: v.created_at, lastSyncAt: router.last_sync_at });
        return Response.json({ ready, known: true });
      },
    },
  },
});
