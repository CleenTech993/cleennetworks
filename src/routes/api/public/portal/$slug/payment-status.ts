import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { queryDarajaStkPush } from "@/lib/daraja.server";
import { markPaymentFailed, settlePayment } from "@/lib/payment-settle.server";
import { rateLimit } from "@/lib/rate-limit.server";

export const Route = createFileRoute("/api/public/portal/$slug/payment-status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "missing id" }, { status: 400 });

        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", params.slug)
          .maybeSingle();
        if (tenantError) {
          console.error("Could not load tenant for payment status", tenantError);
          return Response.json({ error: "Could not check payment status" }, { status: 500 });
        }
        if (!tenant) return new Response("Not found", { status: 404 });

        const { data: pay, error: paymentError } = await supabaseAdmin
          .from("payments")
          .select(
            "id,status,provider,checkout_request_id,package_id,phone,tv_device_id,expires_at,mpesa_receipt,voucher_code",
          )
          .eq("id", id)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (paymentError) {
          console.error("Could not load payment status", paymentError);
          return Response.json({ error: "Could not check payment status" }, { status: 500 });
        }
        if (!pay) return Response.json({ error: "not found" }, { status: 404 });

        if (pay.status === "pending" && pay.provider === "daraja" && pay.checkout_request_id) {
          const canReconcile = rateLimit(`payment-reconcile:${tenant.id}:${pay.id}`, 1, 15_000);
          if (canReconcile) {
            try {
              const verification = await queryDarajaStkPush(tenant.id, pay.checkout_request_id);
              if (verification.resultCode === "0") {
                await settlePayment({
                  payment: {
                    id: pay.id,
                    tenant_id: tenant.id,
                    package_id: pay.package_id,
                    phone: pay.phone,
                    tv_device_id: pay.tv_device_id,
                    expires_at: pay.expires_at,
                  },
                  receipt: null,
                  raw: {
                    source: "daraja_stk_query",
                    resultDescription: verification.resultDescription,
                  },
                });
              } else if (verification.resultCode !== null) {
                await markPaymentFailed(pay.id, {
                  source: "daraja_stk_query",
                  resultCode: verification.resultCode,
                  resultDescription: verification.resultDescription,
                });
              }
            } catch (error) {
              console.error("Could not reconcile pending Daraja payment", error);
              return Response.json(
                { error: "Could not verify payment with M-Pesa" },
                { status: 502 },
              );
            }

            const { data: refreshed, error: refreshError } = await supabaseAdmin
              .from("payments")
              .select("status,mpesa_receipt,voucher_code")
              .eq("id", pay.id)
              .eq("tenant_id", tenant.id)
              .maybeSingle();
            if (refreshError) {
              console.error("Could not refresh reconciled payment status", refreshError);
              return Response.json({ error: "Could not check payment status" }, { status: 500 });
            }
            if (refreshed) {
              return Response.json({ id: pay.id, ...refreshed });
            }
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
