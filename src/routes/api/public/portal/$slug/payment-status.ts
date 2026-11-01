import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { queryDarajaStkPush } from "@/lib/daraja.server";
import { markPaymentFailed, settlePayment } from "@/lib/payment-settle.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";

export const Route = createFileRoute("/api/public/portal/$slug/payment-status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!rateLimit(`payment-status:${clientIp(request)}`, 60, 60_000)) return tooManyRequests();
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (
          !id ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        ) {
          return Response.json({ error: "invalid payment id" }, { status: 400 });
        }

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", params.slug)
          .maybeSingle();
        if (!tenant) return new Response("Not found", { status: 404 });

        const { data: pay } = await supabaseAdmin
          .from("payments")
          .select(
            "id,tenant_id,status,mpesa_receipt,voucher_code,provider,checkout_request_id,package_id,phone,tv_device_id,expires_at",
          )
          .eq("id", id)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!pay) return Response.json({ error: "not found" }, { status: 404 });

        if (
          pay.status === "pending" &&
          pay.provider === "daraja" &&
          pay.checkout_request_id &&
          rateLimit(`payment-reconcile:${pay.id}`, 1, 10_000)
        ) {
          try {
            const result = await queryDarajaStkPush(tenant.id, pay.checkout_request_id);
            if (result.resultCode === "0") {
              await settlePayment({
                payment: {
                  id: pay.id,
                  tenant_id: pay.tenant_id,
                  package_id: pay.package_id,
                  phone: pay.phone,
                  tv_device_id: pay.tv_device_id,
                  expires_at: pay.expires_at,
                },
                receipt: null,
                raw: {
                  source: "daraja_stk_query",
                  checkoutRequestId: pay.checkout_request_id,
                  resultCode: result.resultCode,
                  resultDescription: result.resultDescription,
                } satisfies Json,
              });
            } else if (result.resultCode !== null) {
              await markPaymentFailed(pay.id, {
                source: "daraja_stk_query",
                checkoutRequestId: pay.checkout_request_id,
                resultCode: result.resultCode,
                resultDescription: result.resultDescription,
              } satisfies Json);
            }
          } catch (error) {
            console.error("Payment status reconciliation failed", error);
          }
        }

        const { data: updated } = await supabaseAdmin
          .from("payments")
          .select("id,status,mpesa_receipt,voucher_code")
          .eq("id", pay.id)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!updated) return Response.json({ error: "not found" }, { status: 404 });
        return Response.json({
          id: updated.id,
          status: updated.status,
          mpesa_receipt: updated.mpesa_receipt,
          voucher_code: updated.voucher_code,
        });
      },
    },
  },
});
