import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function requestHostname(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || new URL(request.url).host;
  return host.replace(/:\d+$/, "").replace(/\.$/, "").toLowerCase();
}

export const Route = createFileRoute("/api/public/domain")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const domain = requestHostname(request);
        const { data: registration, error } = await supabaseAdmin
          .from("tenant_domains")
          .select("tenant_id,purpose")
          .eq("domain", domain)
          .not("verified_at", "is", null)
          .maybeSingle();
        if (error) {
          console.error("Custom domain lookup failed", error);
          return Response.json(
            { error: "Domain lookup is temporarily unavailable." },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
        if (!registration) {
          return Response.json(
            { error: "No custom domain is configured." },
            { status: 404, headers: { "Cache-Control": "no-store" } },
          );
        }
        if (registration.purpose === "console") {
          return Response.json(
            { purpose: "console", tenantId: registration.tenant_id },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        const { data: tenant, error: tenantError } = await supabaseAdmin
          .from("tenants")
          .select("slug")
          .eq("id", registration.tenant_id)
          .maybeSingle();
        if (tenantError) {
          console.error("Custom hotspot domain tenant lookup failed", tenantError);
          return Response.json(
            { error: "Domain lookup is temporarily unavailable." },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
        if (!tenant) {
          return Response.json(
            { error: "Custom domain tenant was not found." },
            { status: 404, headers: { "Cache-Control": "no-store" } },
          );
        }
        return Response.json(
          { purpose: "hotspot", slug: tenant.slug },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
