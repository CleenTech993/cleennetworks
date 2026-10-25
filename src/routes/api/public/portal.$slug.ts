import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/portal/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id,name,slug,primary_color,logo_url")
          .eq("slug", params.slug)
          .maybeSingle();
        if (!tenant) return new Response("Not found", { status: 404 });

        const [{ data: portal }, { data: packages }] = await Promise.all([
          supabaseAdmin
            .from("captive_portals")
            .select(
              "logo_url,background_url,primary_color,welcome_text,terms_text,enable_voucher,enable_otp",
            )
            .eq("tenant_id", tenant.id)
            .maybeSingle(),
          supabaseAdmin
            .from("packages")
            .select(
              "id,name,description,price,duration_value,duration_unit,download_kbps,upload_kbps,kind",
            )
            .eq("tenant_id", tenant.id)
            .eq("active", true)
            .in("kind", ["hotspot", "voucher"])
            .order("price"),
        ]);

        return Response.json({ tenant, portal: portal ?? null, packages: packages ?? [] });
      },
    },
  },
});
