import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reconcileIntasendPayment } from "@/lib/intasend-reconcile.server";
import { rateLimit } from "@/lib/rate-limit.server";

export const Route = createFileRoute("/api/public/portal/$slug/payment-status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "missing id" }, { status: 400 });

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", params.slug)
          .maybeSingle();
        if (!tenant) return new Response("Not found", { status: 404 });

        const { data: pay } = await supabaseAdmin
          .from("payments")
          .select("id,status,mpesa_receipt,voucher_code,provider,merchant_request_id")
          .eq("id", id)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!pay) return Response.json({ error: "not found" }, { status: 404 });

        // Safety net for a missed IntaSend webhook: while a payment is still pending, ask IntaSend
        // for its real state (at most once per 8 s per payment, per server instance).
        if (
          pay.status === "pending" &&
          pay.provider === "intasend" &&
          pay.merchant_request_id &&
          rateLimit(`intasend-recon:${pay.id}`, 1, 8_000)
        ) {
          try {
            await reconcileIntasendPayment(pay.id);
            const { data: fresh } = await supabaseAdmin
              .from("payments")
              .select("id,status,mpesa_receipt,voucher_code")
              .eq("id", pay.id)
              .maybeSingle();
            if (fresh) return Response.json(fresh);
          } catch (e) {
            console.error("IntaSend status reconcile failed", e);
          }
        }
        return Response.json({
          id: pay.id,
          status: pay.status,
          mpesa_receipt: pay.mpesa_receipt,
          voucher_code: pay.voucher_code,
        });
      },
    },
  },
});
