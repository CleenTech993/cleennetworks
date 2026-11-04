import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone } from "@/lib/mpesa.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";

export const Route = createFileRoute("/api/public/portal/$slug/status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!rateLimit(`status:${params.slug}:${clientIp(request)}`, 15, 60_000))
          return tooManyRequests();
        const url = new URL(request.url);
        const phone = url.searchParams.get("phone");
        if (!phone) return Response.json({ error: "phone required" }, { status: 400 });

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", params.slug)
          .maybeSingle();
        if (!tenant) return Response.json({ error: "Portal not found" }, { status: 404 });

        const normalized = normalizePhone(phone);
        // Only the active subscription is disclosed, and only to the number itself:
        // full purchase history is never returned to an unverified caller.
        const { data: payments } = await supabaseAdmin
          .from("payments")
          .select("status,expires_at")
          .eq("tenant_id", tenant.id)
          .eq("phone", normalized)
          .order("created_at", { ascending: false })
          .limit(10);

        const activeRow = (payments ?? []).find(
          (p) => p.status === "success" && p.expires_at && new Date(p.expires_at) > new Date(),
        );
        return Response.json({
          active: activeRow ? { expires_at: activeRow.expires_at } : null,
        });
      },
    },
  },
});
