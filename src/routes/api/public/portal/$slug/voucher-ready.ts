import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { routerHasVoucher } from "@/lib/voucher-ready.server";

// Polled by the portal after a voucher is accepted: has the customer's router received it yet?
// Nothing secret is returned (the caller already holds the code), and an unknown code answers
// "ready" so this cannot be used to probe which codes exist.
export const Route = createFileRoute("/api/public/portal/$slug/voucher-ready")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!rateLimit(`vready:${params.slug}:${clientIp(request)}`, 40, 60_000)) {
          return tooManyRequests();
        }
        const url = new URL(request.url);
        const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
        const headers = { "cache-control": "no-store" };
        if (code.length < 4 || code.length > 40) return Response.json({ ready: true }, { headers });

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", params.slug)
          .maybeSingle();
        if (!tenant) return Response.json({ ready: true }, { headers });

        const { data: v } = await supabaseAdmin
          .from("vouchers")
          .select("created_at")
          .eq("tenant_id", tenant.id)
          .eq("code", code)
          .maybeSingle();
        if (!v) return Response.json({ ready: true }, { headers });

        const ready = await routerHasVoucher(
          tenant.id,
          url.searchParams.get("router"),
          v.created_at,
        );
        return Response.json({ ready }, { headers });
      },
    },
  },
});
