import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Schema = z.object({ code: z.string().min(4).max(40), mac: z.string().optional() });

export const Route = createFileRoute("/api/public/portal/$slug/voucher")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        let body: unknown;
        try { body = await request.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

        const { data: tenant } = await supabaseAdmin
          .from("tenants").select("id").eq("slug", params.slug).maybeSingle();
        if (!tenant) return Response.json({ error: "Portal not found" }, { status: 404 });

        const { data: v } = await supabaseAdmin
          .from("vouchers")
          .select("id,status,expires_at,package_id")
          .eq("tenant_id", tenant.id)
          .eq("code", parsed.data.code.trim().toUpperCase())
          .maybeSingle();
        if (!v) return Response.json({ error: "Invalid voucher" }, { status: 404 });
        if (v.status !== "unused") return Response.json({ error: "Voucher already used" }, { status: 400 });
        if (v.expires_at && new Date(v.expires_at) < new Date()) {
          return Response.json({ error: "Voucher expired" }, { status: 400 });
        }

        await supabaseAdmin
          .from("vouchers")
          .update({ status: "used", used_at: new Date().toISOString(), used_by_mac: parsed.data.mac ?? null })
          .eq("id", v.id);

        return Response.json({ ok: true, packageId: v.package_id });
      },
    },
  },
});
