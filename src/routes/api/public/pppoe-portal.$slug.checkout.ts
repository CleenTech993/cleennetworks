import { createFileRoute } from "@tanstack/react-router";
import { getRequestHost } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { startDarajaStkPush } from "@/lib/daraja.server";
import { isValidKenyanMobile } from "@/lib/phone";
import { normalizePhone } from "@/lib/mpesa.server";
import { readPppoePortalSession } from "@/lib/pppoe-portal.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { portalMaintenanceBlock } from "@/lib/maintenance.server";
import {
  tenantServiceRestriction,
  tenantServiceRestrictionMessage,
} from "@/lib/platform-billing.server";

const CheckoutSchema = z.object({
  packageId: z.string().uuid(),
  phone: z.string().min(7).max(20),
});
const PENDING_TIMEOUT_MS = 10 * 60_000;

export const Route = createFileRoute("/api/public/pppoe-portal/$slug/checkout")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await readPppoePortalSession(request, params.slug);
        if (!session)
          return Response.json({ error: "Sign in to renew your account." }, { status: 401 });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid request." }, { status: 400 });
        }
        const parsed = CheckoutSchema.safeParse(body);
        if (!parsed.success)
          return Response.json({ error: "Choose a valid package." }, { status: 400 });

        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("id,name")
          .eq("id", session.tenantId)
          .eq("slug", params.slug)
          .maybeSingle();
        if (tenantError) {
          console.error("Could not load PPPoE checkout tenant", tenantError);
          return Response.json({ error: "Could not start payment." }, { status: 503 });
        }
        if (!tenant) return Response.json({ error: "Portal not found." }, { status: 404 });

        let restriction: Awaited<ReturnType<typeof tenantServiceRestriction>>;
        let maintenanceBlock: string | null;
        try {
          restriction = await tenantServiceRestriction(tenant.id);
          maintenanceBlock = await portalMaintenanceBlock(tenant.id, null);
        } catch (error) {
          console.error("Could not verify PPPoE checkout availability", error);
          return Response.json({ error: "Could not start payment." }, { status: 503 });
        }
        if (restriction) {
          return Response.json(
            { error: tenantServiceRestrictionMessage(restriction) },
            { status: 423 },
          );
        }
        if (maintenanceBlock) return Response.json({ error: maintenanceBlock }, { status: 423 });

        const { data: customer, error: customerError } = await supabaseAdmin
          .from("customers")
          .select("id,status")
          .eq("id", session.customerId)
          .eq("tenant_id", tenant.id)
          .eq("customer_type", "pppoe")
          .maybeSingle();
        if (customerError) {
          console.error("Could not load PPPoE account for checkout", customerError);
          return Response.json({ error: "Could not start payment." }, { status: 503 });
        }
        if (!customer) return Response.json({ error: "Account not found." }, { status: 404 });
        const phone = normalizePhone(parsed.data.phone);
        if (!isValidKenyanMobile(phone)) {
          return Response.json(
            { error: "Enter a valid M-Pesa number, e.g. 0712345678." },
            { status: 400 },
          );
        }

        const { data: invoice, error: invoiceError } = await supabaseAdmin
          .from("customer_invoices")
          .select("id,package_id,amount")
          .eq("tenant_id", tenant.id)
          .eq("customer_id", customer.id)
          .in("status", ["pending", "overdue"])
          .order("issued_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (invoiceError) {
          console.error("Could not load PPPoE renewal invoice", invoiceError);
          return Response.json({ error: "Could not start payment." }, { status: 503 });
        }
        if (invoice && invoice.package_id !== parsed.data.packageId) {
          return Response.json(
            { error: "Pay the outstanding invoice's plan, or contact your provider to change it." },
            { status: 409 },
          );
        }

        const packageQuery = supabaseAdmin
          .from("packages")
          .select("id,name,price,kind,tenant_id,active")
          .eq("id", parsed.data.packageId)
          .eq("tenant_id", tenant.id);
        const { data: pkg, error: packageError } = invoice
          ? await packageQuery.maybeSingle()
          : await packageQuery.eq("active", true).maybeSingle();
        if (packageError) {
          console.error("Could not load PPPoE checkout package", packageError);
          return Response.json({ error: "Could not start payment." }, { status: 503 });
        }
        if (!pkg || pkg.kind !== "pppoe" || (!pkg.active && !invoice)) {
          return Response.json({ error: "That PPPoE package is not available." }, { status: 400 });
        }
        const amount = invoice ? Math.ceil(Number(invoice.amount)) : Math.ceil(Number(pkg.price));
        if (!Number.isSafeInteger(amount) || amount < 1) {
          return Response.json(
            { error: "This package cannot be paid for online." },
            { status: 400 },
          );
        }
        const staleBefore = new Date(Date.now() - PENDING_TIMEOUT_MS).toISOString();
        const { error: expireError } = await supabaseAdmin
          .from("payments")
          .update({ status: "failed" })
          .eq("tenant_id", tenant.id)
          .eq("customer_id", customer.id)
          .eq("status", "pending")
          .lt("created_at", staleBefore);
        if (expireError) {
          console.error("Could not expire stale PPPoE payment", expireError);
          return Response.json({ error: "Could not start payment." }, { status: 503 });
        }
        if (invoice) {
          const { error: expireInvoiceProcessingError } = await supabaseAdmin
            .from("payments")
            .update({ status: "failed" })
            .eq("tenant_id", tenant.id)
            .eq("customer_id", customer.id)
            .eq("customer_invoice_id", invoice.id)
            .eq("status", "processing")
            .lt("created_at", staleBefore);
          if (expireInvoiceProcessingError) {
            console.error("Could not expire stale invoice payment", expireInvoiceProcessingError);
            return Response.json({ error: "Could not start payment." }, { status: 503 });
          }
        }
        const { data: activePayment, error: activePaymentError } = await supabaseAdmin
          .from("payments")
          .select("id,package_id")
          .eq("tenant_id", tenant.id)
          .eq("customer_id", customer.id)
          .in("status", ["pending", "processing"])
          .gte("created_at", staleBefore)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (activePaymentError) {
          console.error("Could not check active PPPoE payment", activePaymentError);
          return Response.json({ error: "Could not start payment." }, { status: 503 });
        }
        if (activePayment) {
          if (activePayment.package_id === pkg.id) {
            return Response.json({
              paymentId: activePayment.id,
              message: "A payment prompt is already active for this account.",
            });
          }
          return Response.json(
            { error: "A payment prompt is already active. Complete it or wait for it to expire." },
            { status: 409 },
          );
        }

        if (
          !rateLimit(`pppoe-portal-checkout-ip:${clientIp(request)}`, 8, 5 * 60_000) ||
          !rateLimit(`pppoe-portal-checkout-customer:${customer.id}`, 4, 5 * 60_000)
        ) {
          return tooManyRequests();
        }

        const { data: payment, error: insertError } = await supabaseAdmin
          .from("payments")
          .insert({
            tenant_id: tenant.id,
            customer_id: customer.id,
            package_id: pkg.id,
            phone,
            amount,
            status: "pending",
            provider: "daraja",
            customer_invoice_id: invoice?.id ?? null,
          })
          .select("id")
          .single();
        if (insertError || !payment) {
          if (insertError?.code === "23505" && invoice) {
            return Response.json(
              {
                error: "A payment prompt is already active. Complete it or wait for it to expire.",
              },
              { status: 409 },
            );
          }
          console.error("Could not create PPPoE portal payment", insertError);
          return Response.json({ error: "Could not start payment." }, { status: 500 });
        }

        let started: { checkoutRequestId: string; merchantRequestId: string };
        try {
          started = await startDarajaStkPush({
            tenantId: tenant.id,
            amount,
            phone,
            paymentId: payment.id,
            description: `${tenant.name || "Internet"} - ${pkg.name}`,
            accountReference: pkg.name,
            callbackUrl: `https://${getRequestHost()}/api/public/mpesa/callback/${tenant.id}`,
          });
        } catch (error) {
          console.error("Could not start PPPoE portal STK push", error);
          const { error: updateError } = await supabaseAdmin
            .from("payments")
            .update({ status: "failed" })
            .eq("id", payment.id)
            .eq("tenant_id", tenant.id);
          if (updateError)
            console.error("Could not fail rejected PPPoE portal payment", updateError);
          return Response.json(
            {
              error:
                "We couldn't start the M-Pesa prompt. Please try again or contact your provider.",
            },
            { status: 502 },
          );
        }

        const { error: updateError } = await supabaseAdmin
          .from("payments")
          .update({
            checkout_request_id: started.checkoutRequestId,
            merchant_request_id: started.merchantRequestId,
          })
          .eq("id", payment.id)
          .eq("tenant_id", tenant.id);
        if (updateError) {
          console.error("Could not save PPPoE portal STK reference", updateError);
          return Response.json({ paymentId: payment.id, message: "M-Pesa prompt sent." });
        }
        return Response.json({
          paymentId: payment.id,
          message: "Check your phone for the M-Pesa prompt.",
        });
      },
    },
  },
});
