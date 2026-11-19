import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import {
  createPppoePortalCookie,
  passwordMatches,
  pppoePortalUsernameHash,
} from "@/lib/pppoe-portal.server";

const LoginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9._@-]+$/),
  password: z.string().min(1).max(128),
});

export const Route = createFileRoute("/api/public/pppoe-portal/$slug/login")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid request." }, { status: 400 });
        }
        const parsed = LoginSchema.safeParse(body);
        if (!parsed.success)
          return Response.json(
            { error: "Enter your PPPoE username and password." },
            { status: 400 },
          );

        const ip = clientIp(request);
        const usernameHash = await pppoePortalUsernameHash(parsed.data.username);
        if (
          !rateLimit(`pppoe-portal-login-ip:${ip}`, 20, 15 * 60_000) ||
          !rateLimit(`pppoe-portal-login-user:${usernameHash}`, 8, 15 * 60_000)
        ) {
          return tooManyRequests();
        }

        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", params.slug)
          .maybeSingle();
        if (tenantError) {
          console.error("Could not look up PPPoE portal tenant", tenantError);
          return Response.json({ error: "Portal temporarily unavailable." }, { status: 503 });
        }
        if (!tenant) return new Response("Not found", { status: 404 });

        const { data: customer, error: customerError } = await supabaseAdmin
          .from("customers")
          .select("id,tenant_id,pppoe_password")
          .eq("tenant_id", tenant.id)
          .eq("customer_type", "pppoe")
          .eq("pppoe_username", parsed.data.username)
          .maybeSingle();
        if (customerError) {
          console.error("Could not verify PPPoE portal credentials", customerError);
          return Response.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
        }

        const matches = await passwordMatches(parsed.data.password, customer?.pppoe_password);
        if (!customer || !matches)
          return Response.json(
            { error: "The username or password is incorrect." },
            { status: 401 },
          );

        try {
          const cookie = await createPppoePortalCookie(customer.id, tenant.id, params.slug);
          return Response.json(
            { ok: true },
            { headers: { "set-cookie": cookie, "cache-control": "no-store" } },
          );
        } catch (error) {
          console.error("Could not create PPPoE portal session", error);
          return Response.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
        }
      },
    },
  },
});
