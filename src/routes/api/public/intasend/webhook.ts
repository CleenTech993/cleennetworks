import { createFileRoute } from "@tanstack/react-router";
import { gatewaySecret, loadGatewaySecrets } from "@/lib/gateway-secrets.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseInvoice, safeEqual } from "@/lib/intasend";
import { reconcileIntasendPayment } from "@/lib/intasend-reconcile.server";

// IntaSend `collection_event` webhook (one URL for the whole platform).
// Set it up in the IntaSend dashboard: Settings -> Webhooks -> New
//   Endpoint:  https://<your-domain>/api/public/intasend/webhook
//   Challenge: the same secret you store as INTASEND_WEBHOOK_CHALLENGE
//   Events:    collection_event
//
// The body is NOT trusted on its own: the challenge only proves the sender knows a shared secret, and
// IntaSend recommends confirming critical events. So the payload just tells us WHICH payment to check;
// the real state, reference and amount always come from IntaSend's status API.
export const Route = createFileRoute("/api/public/intasend/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await loadGatewaySecrets();
        const expected = gatewaySecret("INTASEND_WEBHOOK_CHALLENGE");
        if (!expected) return new Response("Webhook not configured", { status: 503 });

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }

        const challenge = typeof body.challenge === "string" ? body.challenge : "";
        if (!challenge || !safeEqual(challenge, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (body.topic !== "collection_event") return Response.json({ ok: true, note: "Ignored" });

        const invoice = parseInvoice(body);
        // api_ref is the payment id we sent when starting the prompt.
        if (!invoice?.apiRef || !/^[0-9a-f-]{36}$/i.test(invoice.apiRef)) {
          return Response.json({ ok: true, note: "Unknown reference" });
        }

        const { data: payment } = await supabaseAdmin
          .from("payments")
          .select("id,provider,merchant_request_id")
          .eq("id", invoice.apiRef)
          .maybeSingle();
        if (!payment || payment.provider !== "intasend") {
          return Response.json({ ok: true, note: "Unknown payment" });
        }
        // The invoice in the event must be the one we created for this payment.
        if (payment.merchant_request_id && payment.merchant_request_id !== invoice.invoiceId) {
          return Response.json({ ok: true, note: "Invoice mismatch" });
        }

        try {
          const r = await reconcileIntasendPayment(payment.id);
          return Response.json({ ok: true, status: r.status });
        } catch (e) {
          // 5xx makes IntaSend record a failed delivery that can be replayed from the dashboard.
          console.error("IntaSend webhook processing failed", e);
          return Response.json({ ok: false, error: "Processing failed" }, { status: 502 });
        }
      },
    },
  },
});
