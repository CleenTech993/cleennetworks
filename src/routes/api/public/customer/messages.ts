import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";

const ReadSchema = z.object({ announcementId: z.string().uuid() });

async function customerContext(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token)
    return { response: Response.json({ error: "Sign in to view messages." }, { status: 401 }) };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user?.email || !data.user.email_confirmed_at) {
    return {
      response: Response.json(
        { error: "Verify your account email to view messages." },
        { status: 401 },
      ),
    };
  }
  const { data: customers, error: customerError } = await supabaseAdmin
    .from("customers")
    .select("id,tenant_id")
    .eq("email", data.user.email)
    .limit(100);
  if (customerError) {
    console.error("Customer message identity lookup failed", customerError);
    return {
      response: Response.json({ error: "Messages are temporarily unavailable." }, { status: 503 }),
    };
  }
  if (!customers?.length) {
    return {
      response: Response.json(
        { error: "No customer account matches this email." },
        { status: 404 },
      ),
    };
  }
  return { customers };
}

export const Route = createFileRoute("/api/public/customer/messages")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        if (!rateLimit(`customer-messages:${clientIp(request)}`, 30, 60_000))
          return tooManyRequests();
        const context = await customerContext(request);
        if ("response" in context) return context.response;

        const customerIds = context.customers.map((customer) => customer.id);
        const tenantIds = [...new Set(context.customers.map((customer) => customer.tenant_id))];
        const now = new Date().toISOString();
        const { data: announcements, error } = await supabaseAdmin
          .from("customer_announcements")
          .select("id,tenant_id,customer_id,title,body,created_at,ends_at")
          .eq("active", true)
          .lte("starts_at", now)
          .or(`ends_at.is.null,ends_at.gt.${now}`)
          .or(`tenant_id.is.null,tenant_id.in.(${tenantIds.join(",")})`)
          .or(`customer_id.is.null,customer_id.in.(${customerIds.join(",")})`)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) {
          console.error("Customer announcement lookup failed", error);
          return Response.json({ error: "Messages are temporarily unavailable." }, { status: 503 });
        }
        const announcementIds = (announcements ?? []).map((item) => item.id);
        const reads =
          announcementIds.length > 0
            ? await supabaseAdmin
                .from("customer_announcement_reads")
                .select("announcement_id")
                .in("announcement_id", announcementIds)
                .in("customer_id", customerIds)
            : { data: [], error: null };
        if (reads.error) {
          console.error("Customer announcement read status lookup failed", reads.error);
          return Response.json({ error: "Messages are temporarily unavailable." }, { status: 503 });
        }
        const readIds = new Set((reads.data ?? []).map((item) => item.announcement_id));
        return Response.json({
          messages: (announcements ?? []).map((item) => ({ ...item, read: readIds.has(item.id) })),
        });
      },
      POST: async ({ request }: { request: Request }) => {
        if (!rateLimit(`customer-message-read:${clientIp(request)}`, 60, 60_000))
          return tooManyRequests();
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }
        const parsed = ReadSchema.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Invalid message." }, { status: 400 });

        const context = await customerContext(request);
        if ("response" in context) return context.response;
        const customerIds = context.customers.map((customer) => customer.id);
        const tenantIds = [...new Set(context.customers.map((customer) => customer.tenant_id))];
        const now = new Date().toISOString();
        const { data: announcement, error } = await supabaseAdmin
          .from("customer_announcements")
          .select("id,tenant_id,customer_id")
          .eq("id", parsed.data.announcementId)
          .eq("active", true)
          .lte("starts_at", now)
          .or(`ends_at.is.null,ends_at.gt.${now}`)
          .maybeSingle();
        if (error) {
          console.error("Customer announcement access check failed", error);
          return Response.json({ error: "Could not update this message." }, { status: 503 });
        }
        const canRead = announcement
          ? announcement.customer_id
            ? customerIds.includes(announcement.customer_id)
            : announcement.tenant_id === null || tenantIds.includes(announcement.tenant_id)
          : false;
        if (!announcement || !canRead)
          return Response.json({ error: "Message not found." }, { status: 404 });

        const matchingCustomers = announcement.customer_id
          ? [announcement.customer_id]
          : context.customers
              .filter(
                (customer) =>
                  announcement.tenant_id === null || customer.tenant_id === announcement.tenant_id,
              )
              .map((customer) => customer.id);
        const { error: readError } = await supabaseAdmin.from("customer_announcement_reads").upsert(
          matchingCustomers.map((customer_id) => ({
            announcement_id: announcement.id,
            customer_id,
          })),
          { onConflict: "announcement_id,customer_id", ignoreDuplicates: true },
        );
        if (readError) {
          console.error("Customer announcement read update failed", readError);
          return Response.json({ error: "Could not update this message." }, { status: 503 });
        }
        return Response.json({ read: true });
      },
    },
  },
});
