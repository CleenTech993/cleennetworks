import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone } from "@/lib/mpesa.server";

export const Route = createFileRoute("/api/public/portal/$slug/status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const phone = url.searchParams.get("phone");
        if (!phone) return Response.json({ error: "phone required" }, { status: 400 });

        const { data: tenant } = await supabaseAdmin
          .from("tenants").select("id").eq("slug", params.slug).maybeSingle();
        if (!tenant) return Response.json({ error: "Portal not found" }, { status: 404 });

        const normalized = normalizePhone(phone);
        const { data: payments } = await supabaseAdmin
          .from("payments")
          .select("id,amount,status,expires_at,mpesa_receipt,voucher_code,created_at,package_id")
          .eq("tenant_id", tenant.id)
          .eq("phone", normalized)
          .order("created_at", { ascending: false })
          .limit(10);

        const list = payments ?? [];
        const active = list.find((p) => p.status === "success" && p.expires_at && new Date(p.expires_at) > new Date()) ?? null;
        return Response.json({ active, history: list });
      },
    },
  },
});
