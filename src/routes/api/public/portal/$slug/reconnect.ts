import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone } from "@/lib/mpesa.server";

const Schema = z.object({
  phone: z.string().min(7).max(20).optional(),
  mpesaCode: z.string().min(4).max(40).optional(),
}).refine((v) => v.phone || v.mpesaCode, { message: "Provide phone or M-Pesa code" });

export const Route = createFileRoute("/api/public/portal/$slug/reconnect")({
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

        let q = supabaseAdmin
          .from("payments")
          .select("id,status,expires_at,phone,mpesa_receipt,voucher_code,package_id,created_at")
          .eq("tenant_id", tenant.id)
          .eq("status", "success")
          .order("created_at", { ascending: false })
          .limit(1);

        if (parsed.data.mpesaCode) {
          q = q.eq("mpesa_receipt", parsed.data.mpesaCode.trim().toUpperCase());
        } else if (parsed.data.phone) {
          q = q.eq("phone", normalizePhone(parsed.data.phone));
        }

        const { data: pay } = await q.maybeSingle();
        if (!pay) return Response.json({ active: false, reason: "No purchase found" });

        const now = Date.now();
        const exp = pay.expires_at ? new Date(pay.expires_at).getTime() : 0;
        if (!exp || exp < now) {
          return Response.json({ active: false, reason: "Package expired" });
        }

        const { data: pkg } = pay.package_id
          ? await supabaseAdmin.from("packages").select("name,duration_value,duration_unit").eq("id", pay.package_id).maybeSingle()
          : { data: null };

        return Response.json({
          active: true,
          package: pkg,
          expires_at: pay.expires_at,
          remaining_minutes: Math.max(0, Math.floor((exp - now) / 60000)),
          voucher_code: pay.voucher_code,
          mpesa_receipt: pay.mpesa_receipt,
        });
      },
    },
  },
});
