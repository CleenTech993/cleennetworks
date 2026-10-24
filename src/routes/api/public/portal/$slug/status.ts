import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone } from "@/lib/mpesa.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";

export const Route = createFileRoute("/api/public/portal/$slug/status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!rateLimit(`status:${params.slug}:${clientIp(request)}`, 15, 60_000)) return tooManyRequests();
        const url = new URL(request.url);
        const phone = url.searchParams.get("phone");
        if (!phone) return Response.json({ error: "phone required" }, { status: 400 });

        const { data: tenant } = await supabaseAdmin
          .from("tenants").select("id").eq("slug", params.slug).maybeSingle();
        if (!tenant) return Response.json({ error: "Portal not found" }, { status: 404 });

        const normalized = normalizePhone(phone);
        const { data: payments } = await supabaseAdmin
          .from("payments")
          .select("amount,status,expires_at,mpesa_receipt,created_at")
          .eq("tenant_id", tenant.id)
          .eq("phone", normalized)
          .order("created_at", { ascending: false })
          .limit(10);

        // Phone number alone is public info: never return payment ids (they unlock
        // payment-status) or voucher codes, and mask receipts.
        const mask = (r: string | null) => (r ? `••••${r.slice(-4)}` : null);
        const list = (payments ?? []).map((p) => ({ ...p, mpesa_receipt: mask(p.mpesa_receipt) }));
        const active = list.find((p) => p.status === "success" && p.expires_at && new Date(p.expires_at) > new Date()) ?? null;
        return Response.json({ active, history: list });
      },
    },
  },
});
