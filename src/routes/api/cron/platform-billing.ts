import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendPlatformInvoiceEmail } from "@/lib/platform-invoice-email.server";
import { loadPlatformServiceSecrets } from "@/lib/platform-service-secrets.server";

function isAuthorized(request: Request): boolean {
  const expected = process.env["CRON_SECRET"];
  const authorization = request.headers.get("authorization") ?? "";
  if (!expected || !authorization.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export const Route = createFileRoute("/api/cron/platform-billing")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request))
          return Response.json({ error: "Unauthorized" }, { status: 401 });

        const { data: invoicesCreated, error: generationError } = await supabaseAdmin.rpc(
          "generate_monthly_platform_commission_invoices",
          {},
        );
        if (generationError) {
          console.error("Could not generate monthly platform invoices", generationError);
          return Response.json({ error: "Could not generate invoices" }, { status: 500 });
        }

        const { data: customerInvoicesCreated, error: customerInvoiceError } =
          await supabaseAdmin.rpc("generate_due_customer_invoices", {});
        if (customerInvoiceError) {
          console.error("Could not generate customer renewal invoices", customerInvoiceError);
          return Response.json({ error: "Could not generate customer invoices" }, { status: 500 });
        }

        const { data: tenantsSuspended, error: suspensionError } = await supabaseAdmin.rpc(
          "refresh_overdue_tenant_billing",
          {},
        );
        if (suspensionError) {
          console.error("Could not refresh overdue tenant service status", suspensionError);
          return Response.json(
            { error: "Could not update overdue billing status" },
            { status: 500 },
          );
        }

        const { data: invoices, error: claimError } = await supabaseAdmin.rpc(
          "claim_platform_invoice_emails",
          { p_limit: 50 },
        );
        if (claimError) {
          console.error("Could not claim platform invoices for email", claimError);
          return Response.json({ error: "Could not process invoice emails" }, { status: 500 });
        }

        const tenantIds = [...new Set((invoices ?? []).map((invoice) => invoice.tenant_id))];
        const [
          { data: tenants, error: tenantsError },
          { data: platformConfig, error: configError },
        ] = await Promise.all([
          tenantIds.length
            ? supabaseAdmin.from("tenants").select("id,name,support_email").in("id", tenantIds)
            : Promise.resolve({ data: [], error: null }),
          supabaseAdmin.from("platform_mpesa_config").select("shortcode").eq("id", 1).maybeSingle(),
        ]);
        if (tenantsError || configError) {
          console.error("Could not load invoice delivery details", tenantsError ?? configError);
          return Response.json(
            { error: "Could not load invoice delivery details" },
            { status: 500 },
          );
        }

        const tenantById = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant]));
        const platformSecrets = await loadPlatformServiceSecrets();
        const platformMerchantType =
          platformSecrets.PLATFORM_MPESA_MERCHANT_TYPE === "buygoods" ? "buygoods" : "paybill";
        let emailsSent = 0;
        let emailsFailed = 0;
        for (const invoice of invoices ?? []) {
          const tenant = tenantById.get(invoice.tenant_id);
          const recipient = tenant?.support_email?.trim();
          if (!tenant || !recipient) {
            const { error } = await supabaseAdmin
              .from("platform_commissions")
              .update({
                email_status: "failed",
                email_error: "Tenant support email is not configured.",
              })
              .eq("id", invoice.id)
              .eq("email_status", "sending");
            if (error) {
              console.error("Could not record missing invoice recipient", error);
              return Response.json(
                { error: "Could not update invoice email status" },
                { status: 500 },
              );
            }
            emailsFailed += 1;
            continue;
          }

          try {
            const tieredFields = [
              invoice.hotspot_gross_amount,
              invoice.pppoe_gross_amount,
              invoice.hotspot_commission_amount,
              invoice.pppoe_commission_amount,
              invoice.hotspot_commission_rate_pct,
              invoice.pppoe_commission_rate_pct,
            ];
            const hasTieredBreakdown = tieredFields.every((value) => typeof value === "number");
            if (
              !invoice.invoice_number ||
              !invoice.payment_reference ||
              !invoice.issued_at ||
              !invoice.due_at ||
              (!hasTieredBreakdown &&
                (typeof invoice.commission_rate_pct !== "number" ||
                  invoice.commission_rate_pct === null))
            ) {
              throw new Error("Invoice fields are incomplete.");
            }
            await sendPlatformInvoiceEmail({
              recipient,
              tenantName: tenant.name,
              invoiceNumber: invoice.invoice_number,
              paymentReference: invoice.payment_reference,
              periodStart: invoice.period_start,
              periodEnd: invoice.period_end,
              issuedAt: invoice.issued_at,
              dueAt: invoice.due_at,
              grossAmount: Number(invoice.gross_amount),
              commissionAmount: Number(invoice.commission_amount),
              ...(hasTieredBreakdown
                ? {
                    hotspotGrossAmount: Number(invoice.hotspot_gross_amount),
                    pppoeGrossAmount: Number(invoice.pppoe_gross_amount),
                    hotspotCommissionAmount: Number(invoice.hotspot_commission_amount),
                    pppoeCommissionAmount: Number(invoice.pppoe_commission_amount),
                    hotspotCommissionRatePct: Number(invoice.hotspot_commission_rate_pct),
                    pppoeCommissionRatePct: Number(invoice.pppoe_commission_rate_pct),
                  }
                : { commissionRatePct: Number(invoice.commission_rate_pct) }),
              platformShortcode: platformConfig?.shortcode ?? null,
              platformMerchantType,
            });
          } catch (error) {
            console.error(`Invoice email delivery failed for ${invoice.id}`, error);
            const { error: updateError } = await supabaseAdmin
              .from("platform_commissions")
              .update({
                email_status: "failed",
                email_error: "Email delivery failed. Check platform SMTP configuration.",
              })
              .eq("id", invoice.id)
              .eq("email_status", "sending");
            if (updateError) {
              console.error("Could not record invoice email failure", updateError);
              return Response.json(
                { error: "Could not update invoice email status" },
                { status: 500 },
              );
            }
            emailsFailed += 1;
            continue;
          }

          const { error: sentError } = await supabaseAdmin
            .from("platform_commissions")
            .update({
              email_status: "sent",
              email_error: null,
              email_sent_at: new Date().toISOString(),
            })
            .eq("id", invoice.id)
            .eq("email_status", "sending");
          if (sentError) {
            console.error("Could not record sent platform invoice email", sentError);
            return Response.json(
              { error: "Could not update invoice email status" },
              { status: 500 },
            );
          }
          emailsSent += 1;
        }

        return Response.json({
          invoicesCreated: invoicesCreated ?? 0,
          customerInvoicesCreated: customerInvoicesCreated ?? 0,
          tenantsSuspended: tenantsSuspended ?? 0,
          emailsSent,
          emailsFailed,
        });
      },
    },
  },
});
