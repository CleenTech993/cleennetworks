import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveThemeId } from "@/lib/portal-themes";
import {
  tenantServiceRestriction,
  tenantServiceRestrictionMessage,
} from "@/lib/platform-billing.server";
import { activeMaintenance } from "@/lib/maintenance.server";
import { z } from "zod";

const RouterIdSchema = z.string().uuid();

export const Route = createFileRoute("/api/public/portal/$slug")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const requestUrl = new URL(request.url);
        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("id,name,slug,primary_color,logo_url,support_phone,support_email")
          .eq("slug", params.slug)
          .maybeSingle();
        if (tenantError) {
          console.error("Public portal tenant lookup failed", tenantError);
          return Response.json({ error: "Portal temporarily unavailable." }, { status: 503 });
        }
        if (!tenant) return new Response("Not found", { status: 404 });

        const restriction = await tenantServiceRestriction(tenant.id);
        if (restriction) {
          return Response.json(
            { error: tenantServiceRestrictionMessage(restriction) },
            { status: 423 },
          );
        }

        let routerId: string | null = null;
        const rawRouterId = requestUrl.searchParams.get("router");
        if (rawRouterId) {
          const parsedRouterId = RouterIdSchema.safeParse(rawRouterId);
          if (!parsedRouterId.success)
            return Response.json({ error: "Invalid site." }, { status: 400 });
          const { data: router, error: routerError } = await supabaseAdmin
            .from("routers")
            .select("id")
            .eq("id", parsedRouterId.data)
            .eq("tenant_id", tenant.id)
            .maybeSingle();
          if (routerError) {
            console.error("Captive portal site lookup failed", routerError);
            return Response.json({ error: "Portal temporarily unavailable." }, { status: 503 });
          }
          if (!router) return Response.json({ error: "Invalid site." }, { status: 404 });
          routerId = router.id;
        }

        const now = new Date().toISOString();
        const [
          { data: portal, error: portalError },
          { data: packages, error: packagesError },
          { data: announcements, error: announcementsError },
          maintenance,
        ] = await Promise.all([
          supabaseAdmin
            .from("captive_portals")
            // "*" (fields picked below) so branding keeps working even before the theme column exists.
            .select("*")
            .eq("tenant_id", tenant.id)
            .maybeSingle(),
          supabaseAdmin
            .from("packages")
            .select(
              "id,name,description,price,duration_value,duration_unit,download_kbps,upload_kbps,kind",
            )
            .eq("tenant_id", tenant.id)
            .eq("active", true)
            .in("kind", ["hotspot", "voucher"])
            .order("price"),
          supabaseAdmin
            .from("customer_announcements")
            .select("id,title,body,starts_at,ends_at")
            .eq("active", true)
            .is("customer_id", null)
            .lte("starts_at", now)
            .or(`ends_at.is.null,ends_at.gt.${now}`)
            .or(`tenant_id.is.null,tenant_id.eq.${tenant.id}`)
            .order("starts_at", { ascending: false })
            .limit(10),
          activeMaintenance(tenant.id, routerId),
        ]);
        if (portalError || packagesError || announcementsError) {
          const error = portalError ?? packagesError ?? announcementsError;
          console.error("Captive portal configuration lookup failed", error);
          return Response.json({ error: "Portal temporarily unavailable." }, { status: 503 });
        }

        const publicPortal = portal
          ? {
              logo_url: portal.logo_url,
              background_url: portal.background_url,
              primary_color: portal.primary_color,
              welcome_text: portal.welcome_text,
              terms_text: portal.terms_text,
              enable_voucher: portal.enable_voucher,
              enable_otp: portal.enable_otp,
              post_login_url: portal.post_login_url,
              theme: resolveThemeId((portal as { theme?: unknown }).theme),
            }
          : null;

        return Response.json({
          tenant,
          portal: publicPortal,
          packages: packages ?? [],
          announcements: announcements ?? [],
          maintenance,
        });
      },
    },
  },
});
