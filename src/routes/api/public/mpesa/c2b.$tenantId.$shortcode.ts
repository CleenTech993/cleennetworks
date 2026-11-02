import { createFileRoute } from "@tanstack/react-router";
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadTenantServiceSecrets } from "@/lib/tenant-service-secrets.server";
import { normalizePhone } from "@/lib/mpesa.server";

type C2bCallback = {
  TransID?: string;
  TransTime?: string;
  TransAmount?: string | number;
  BusinessShortCode?: string | number;
  ShortCode?: string | number;
  BillRefNumber?: string;
  MSISDN?: string | number;
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
};

function transactionDate(value: string): string | null {
  if (!/^\d{14}$/.test(value)) return null;
  const [year, month, day, hour, minute, second] = [
    value.slice(0, 4),
    value.slice(4, 6),
    value.slice(6, 8),
    value.slice(8, 10),
    value.slice(10, 12),
    value.slice(12, 14),
  ].map(Number);
  const localTime = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(localTime);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }
  return new Date(localTime - 3 * 60 * 60 * 1000).toISOString();
}

export const Route = createFileRoute("/api/public/mpesa/c2b/$tenantId/$shortcode")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        let body: C2bCallback;
        try {
          body = (await request.json()) as C2bCallback;
        } catch {
          return Response.json(
            { ResultCode: 1, ResultDesc: "Invalid callback body" },
            { status: 400 },
          );
        }

        const transactionId = body.TransID?.trim();
        const shortcode = String(body.BusinessShortCode ?? body.ShortCode ?? "");
        const amount = Number(body.TransAmount);
        const occurredAt = body.TransTime ? transactionDate(body.TransTime) : null;
        if (
          !transactionId ||
          transactionId.length > 64 ||
          !/^[A-Z0-9]+$/i.test(transactionId) ||
          shortcode !== params.shortcode ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          amount > 1_000_000_000 ||
          !occurredAt
        ) {
          return Response.json(
            { ResultCode: 1, ResultDesc: "Invalid transaction details" },
            { status: 400 },
          );
        }

        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("id,mpesa_paybill,mpesa_till")
          .eq("id", params.tenantId)
          .maybeSingle();
        if (tenantError) {
          console.error("C2B tenant lookup failed", tenantError);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Callback unavailable" },
            { status: 503 },
          );
        }
        if (!tenant)
          return Response.json({ ResultCode: 1, ResultDesc: "Unknown shortcode" }, { status: 404 });

        let secrets;
        try {
          secrets = await loadTenantServiceSecrets(tenant.id);
        } catch (error) {
          console.error("C2B tenant credential lookup failed", error);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Callback unavailable" },
            { status: 503 },
          );
        }
        const registeredShortcodes = [
          tenant.mpesa_paybill,
          tenant.mpesa_till,
          secrets.MPESA_SHORTCODE,
        ]
          .filter((value): value is string => Boolean(value?.trim()))
          .map((value) => value.trim());
        if (!registeredShortcodes.includes(shortcode))
          return Response.json({ ResultCode: 1, ResultDesc: "Unknown shortcode" }, { status: 404 });

        const { data: duplicate, error: duplicateError } = await supabaseAdmin
          .from("direct_mpesa_transactions")
          .select("id,tenant_id,shortcode")
          .eq("transaction_id", transactionId)
          .maybeSingle();
        if (duplicateError) {
          console.error("C2B duplicate lookup failed", duplicateError);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Callback unavailable" },
            { status: 503 },
          );
        }
        if (duplicate) {
          return duplicate.tenant_id === tenant.id && duplicate.shortcode === shortcode
            ? Response.json({ ResultCode: 0, ResultDesc: "Accepted" })
            : Response.json(
                { ResultCode: 1, ResultDesc: "Duplicate transaction" },
                { status: 409 },
              );
        }

        const phone = body.MSISDN ? normalizePhone(String(body.MSISDN)) : null;
        const reference = body.BillRefNumber?.trim() || null;
        let suggestedCustomerId: string | null = null;
        if (reference) {
          const { data: byUsername, error } = await supabaseAdmin
            .from("customers")
            .select("id")
            .eq("tenant_id", tenant.id)
            .eq("customer_type", "pppoe")
            .eq("pppoe_username", reference)
            .maybeSingle();
          if (error) {
            console.error("C2B PPPoE reference lookup failed", error);
            return Response.json(
              { ResultCode: 1, ResultDesc: "Callback unavailable" },
              { status: 503 },
            );
          }
          suggestedCustomerId = byUsername?.id ?? null;
        }
        if (!suggestedCustomerId && phone) {
          const { data: matches, error } = await supabaseAdmin
            .from("customers")
            .select("id")
            .eq("tenant_id", tenant.id)
            .eq("customer_type", "pppoe")
            .eq("phone", phone)
            .limit(2);
          if (error) {
            console.error("C2B customer phone lookup failed", error);
            return Response.json(
              { ResultCode: 1, ResultDesc: "Callback unavailable" },
              { status: 503 },
            );
          }
          if (matches?.length === 1) suggestedCustomerId = matches[0].id;
        }

        const { error: insertError } = await supabaseAdmin
          .from("direct_mpesa_transactions")
          .insert({
            tenant_id: tenant.id,
            shortcode,
            transaction_id: transactionId,
            transaction_time: occurredAt,
            amount,
            bill_ref_number: reference,
            phone,
            first_name: body.FirstName?.slice(0, 100) ?? null,
            middle_name: body.MiddleName?.slice(0, 100) ?? null,
            last_name: body.LastName?.slice(0, 100) ?? null,
            suggested_customer_id: suggestedCustomerId,
            status: "received",
            raw_payload: body as unknown as Json,
          });
        if (insertError) {
          console.error("C2B transaction insert failed", insertError);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Could not record transaction" },
            { status: 503 },
          );
        }
        return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
      },
    },
  },
});
