import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/portal/$slug/payment-status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "missing id" }, { status: 400 });

        const { data: tenant } = await supabaseAdmin
          .from("tenants").select("id").eq("slug", params.slug).maybeSingle();
        if (!tenant) return new Response("Not found", { status: 404 });

        const { data: pay } = await supabaseAdmin
          .from("payments")
          .select("id,status,mpesa_receipt,voucher_code")
          .eq("id", id)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!pay) return Response.json({ error: "not found" }, { status: 404 });
        return Response.json(pay);
      },
    },
  },
});
