import { randomBytes, createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { getRequestHost } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appHost } from "@/lib/app-host.server";
import { getTenantManualPaymentDetails, requestTenantTransactionStatus } from "@/lib/daraja.server";
import { extractMpesaReceiptCode } from "@/lib/mpesa-receipt";
import {
  tenantServiceRestriction,
  tenantServiceRestrictionMessage,
} from "@/lib/platform-billing.server";
import { portalMaintenanceBlock } from "@/lib/maintenance.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";

const Schema = z.object({
  paymentId: z.string().uuid(),
  receipt: z.string().trim().min(6).max(1000),
});
const VERIFICATION_TIMEOUT_MS = 5 * 60_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const Route = createFileRoute("/api/public/portal/$slug/manual-payment")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!rateLimit(`manual-payment:${params.slug}:${clientIp(request)}`, 5, 60_000))
          return tooManyRequests();

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Bad JSON" }, { status: 400 });
        }
        const parsed = Schema.safeParse(body);
        if (!parsed.success)
          return Response.json({ error: "Invalid payment details." }, { status: 400 });
        const receipt = extractMpesaReceiptCode(parsed.data.receipt);
        if (!receipt) {
          return Response.json(
            { error: "Enter the M-Pesa receipt code from your payment confirmation." },
            { status: 400 },
          );
        }

        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", params.slug)
          .maybeSingle();
        if (tenantError) {
          console.error("Manual payment tenant lookup failed", tenantError);
          return Response.json({ error: "Could not verify this payment." }, { status: 503 });
        }
        if (!tenant) return Response.json({ error: "Portal not found." }, { status: 404 });

        const restriction = await tenantServiceRestriction(tenant.id);
        if (restriction) {
          return Response.json(
            { error: tenantServiceRestrictionMessage(restriction) },
            { status: 423 },
          );
        }

        const { data: payment, error: paymentError } = await supabaseAdmin
          .from("payments")
          .select(
            "id,tenant_id,provider,status,package_id,customer_id,phone,amount,tv_device_id,expires_at,customer_invoice_id,created_at,mpesa_receipt,manual_mpesa_receipt,manual_verification_status,manual_verification_requested_at",
          )
          .eq("id", parsed.data.paymentId)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (paymentError) {
          console.error("Manual payment lookup failed", paymentError);
          return Response.json({ error: "Could not verify this payment." }, { status: 503 });
        }
        if (!payment || payment.provider !== "daraja" || !payment.package_id) {
          return Response.json({ error: "Payment not found." }, { status: 404 });
        }
        if (
          payment.status === "success" &&
          (payment.mpesa_receipt === receipt || payment.manual_mpesa_receipt === receipt)
        ) {
          return Response.json({ status: "verified" });
        }
        if (payment.status !== "failed") {
          return Response.json(
            { error: "This payment is not available for manual verification." },
            { status: 409 },
          );
        }
        if (Date.now() - Date.parse(payment.created_at) > 24 * 60 * 60_000) {
          return Response.json(
            { error: "This payment attempt has expired. Start a new checkout." },
            { status: 410 },
          );
        }

        const maintenanceBlock = await portalMaintenanceBlock(tenant.id, null);
        if (maintenanceBlock) {
          return Response.json({ error: maintenanceBlock }, { status: 423 });
        }

        const manualDetails = await getTenantManualPaymentDetails(tenant.id);
        if (!manualDetails?.verificationConfigured) {
          return Response.json(
            {
              error: "Secure manual payment verification is not configured. Contact the provider.",
            },
            { status: 503 },
          );
        }

        const { data: alreadyUsed, error: usedError } = await supabaseAdmin
          .from("payments")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("mpesa_receipt", receipt)
          .maybeSingle();
        if (usedError) {
          console.error("Manual receipt reuse check failed", usedError);
          return Response.json({ error: "Could not verify this receipt." }, { status: 503 });
        }
        if (alreadyUsed && alreadyUsed.id !== payment.id) {
          return Response.json(
            { error: "This M-Pesa receipt has already been used." },
            { status: 409 },
          );
        }

        let currentPayment = payment;
        if (
          ["pending", "processing"].includes(payment.manual_verification_status ?? "") &&
          payment.manual_mpesa_receipt === receipt
        ) {
          const age = payment.manual_verification_requested_at
            ? Date.now() - Date.parse(payment.manual_verification_requested_at)
            : 0;
          if (
            age < VERIFICATION_TIMEOUT_MS ||
            payment.manual_verification_status === "processing"
          ) {
            return Response.json({ status: "pending" });
          }
          const { error: expireError } = await supabaseAdmin
            .from("payments")
            .update({
              manual_verification_status: "failed",
              manual_verification_error: "M-Pesa did not return a verification result. Try again.",
            })
            .eq("id", payment.id)
            .eq("manual_verification_status", "pending");
          if (expireError) {
            console.error("Could not expire manual payment verification", expireError);
            return Response.json(
              { error: "Could not restart receipt verification." },
              { status: 503 },
            );
          }
          currentPayment = { ...payment, manual_verification_status: "failed" };
        } else if (["pending", "processing"].includes(payment.manual_verification_status ?? "")) {
          return Response.json(
            { error: "Another receipt is already being verified for this payment." },
            { status: 409 },
          );
        }

        const host = appHost(getRequestHost());
        if (!host) {
          return Response.json(
            { error: "Secure payment verification is unavailable." },
            { status: 503 },
          );
        }
        const token = randomBytes(32).toString("hex");
        const tokenHash = hashToken(token);
        let updateQuery = supabaseAdmin
          .from("payments")
          .update({
            manual_mpesa_receipt: receipt,
            manual_verification_token_hash: tokenHash,
            manual_verification_status: "pending",
            manual_verification_error: null,
            manual_verification_requested_at: new Date().toISOString(),
          })
          .eq("id", payment.id)
          .eq("tenant_id", tenant.id)
          .eq("status", "failed");
        if (currentPayment.manual_verification_status === "failed") {
          updateQuery = updateQuery.eq("manual_verification_status", "failed");
        } else {
          updateQuery = updateQuery.is("manual_verification_status", null);
        }
        const { data: claimed, error: claimError } = await updateQuery.select("id").maybeSingle();
        if (claimError) {
          console.error("Could not claim manual payment verification", claimError);
          return Response.json({ error: "Could not start receipt verification." }, { status: 503 });
        }
        if (!claimed) {
          return Response.json(
            { error: "Another receipt is already being verified for this payment." },
            { status: 409 },
          );
        }

        const callbackBase = `https://${host}/api/public/mpesa/transaction-status/${token}`;
        try {
          await requestTenantTransactionStatus({
            tenantId: tenant.id,
            transactionId: receipt,
            resultUrl: `${callbackBase}?kind=result`,
            queueTimeoutUrl: `${callbackBase}?kind=timeout`,
          });
        } catch (error) {
          console.error("Could not request manual M-Pesa receipt verification", error);
          const { error: updateError } = await supabaseAdmin
            .from("payments")
            .update({
              manual_verification_status: "failed",
              manual_verification_error: "M-Pesa could not start receipt verification. Try again.",
            })
            .eq("id", payment.id)
            .eq("manual_verification_token_hash", tokenHash)
            .eq("manual_verification_status", "pending");
          if (updateError) {
            console.error("Could not save manual verification failure", updateError);
            return Response.json(
              { error: "Could not start receipt verification." },
              { status: 503 },
            );
          }
          return Response.json(
            { error: "M-Pesa could not start receipt verification. Check the code and try again." },
            { status: 502 },
          );
        }

        return Response.json({ status: "pending" });
      },
    },
  },
});
