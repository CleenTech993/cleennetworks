import { resolveCname, resolveTxt } from "node:dns/promises";
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { z } from "zod";

const VerifySchema = z.object({ domainId: z.string().uuid() });

function normalizeHost(host: string) {
  return host
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

async function dnsRecords<T>(
  read: () => Promise<T>,
): Promise<{ records: T; error: null } | { records: null; error: string }> {
  try {
    return { records: await read(), error: null };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "ESERVFAIL") {
      return {
        records: null,
        error: "DNS records are not visible yet. Wait for propagation and retry.",
      };
    }
    console.error("Custom domain DNS lookup failed", error);
    return { records: null, error: "DNS lookup failed. Retry later or contact your host." };
  }
}

export const Route = createFileRoute("/api/tenant/domains/verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization");
        const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token) return Response.json({ error: "Sign in to verify a domain." }, { status: 401 });

        const { data: tokenData, error: tokenError } = await supabaseAdmin.auth.getClaims(token);
        const claims = tokenData?.claims;
        if (tokenError || !claims?.sub) {
          return Response.json(
            { error: "Your session is invalid. Sign in again." },
            { status: 401 },
          );
        }
        if (claims.aal !== "aal2") {
          return Response.json(
            { error: "Complete two-step verification before verifying a domain." },
            { status: 403 },
          );
        }
        if (!rateLimit(`tenant-domain-verify:${claims.sub}:${clientIp(request)}`, 5, 60_000)) {
          return tooManyRequests();
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }
        const parsed = VerifySchema.safeParse(body);
        if (!parsed.success)
          return Response.json({ error: "Invalid domain registration." }, { status: 400 });

        const { data: registration, error: domainError } = await supabaseAdmin
          .from("tenant_domains")
          .select("id,tenant_id,domain,purpose,verification_token,verified_at")
          .eq("id", parsed.data.domainId)
          .maybeSingle();
        if (domainError) {
          console.error("Custom domain verification lookup failed", domainError);
          return Response.json({ error: "Could not load domain registration." }, { status: 503 });
        }
        if (!registration)
          return Response.json({ error: "Domain registration not found." }, { status: 404 });

        const { data: roles, error: rolesError } = await supabaseAdmin
          .from("user_roles")
          .select("role,tenant_id")
          .eq("user_id", claims.sub);
        if (rolesError) {
          console.error("Custom domain verifier role lookup failed", rolesError);
          return Response.json({ error: "Could not verify access." }, { status: 503 });
        }
        const authorized = roles?.some(
          (role) =>
            role.role === "super_admin" ||
            (role.role === "tenant_admin" && role.tenant_id === registration.tenant_id),
        );
        if (!authorized)
          return Response.json(
            { error: "Only this tenant's admin can verify its domain." },
            { status: 403 },
          );

        const canonicalHost = normalizeHost(process.env.APP_CANONICAL_HOST ?? "");
        if (!canonicalHost) {
          return Response.json(
            {
              error:
                "Domain verification is not configured. Set APP_CANONICAL_HOST on the application server.",
            },
            { status: 503 },
          );
        }

        const [txtResult, cnameResult] = await Promise.all([
          dnsRecords(() => resolveTxt(`_netgrid-verify.${registration.domain}`)),
          dnsRecords(() => resolveCname(registration.domain)),
        ]);
        if (txtResult.error !== null) {
          return Response.json({ error: txtResult.error }, { status: 400 });
        }
        if (cnameResult.error !== null) {
          return Response.json({ error: cnameResult.error }, { status: 400 });
        }

        const hasToken = txtResult.records.some(
          (record) => record.join("").trim() === registration.verification_token,
        );
        if (!hasToken) {
          return Response.json(
            {
              error: `Add the TXT record _netgrid-verify.${registration.domain} with the token shown in Settings.`,
            },
            { status: 400 },
          );
        }
        const hasTarget = cnameResult.records.some(
          (record) => normalizeHost(record) === canonicalHost,
        );
        if (!hasTarget) {
          return Response.json(
            { error: `Point ${registration.domain} to ${canonicalHost} with a CNAME record.` },
            { status: 400 },
          );
        }

        const { error: updateError } = await supabaseAdmin
          .from("tenant_domains")
          .update({ verified_at: new Date().toISOString() })
          .eq("id", registration.id)
          .eq("tenant_id", registration.tenant_id);
        if (updateError) {
          console.error("Custom domain verification update failed", updateError);
          return Response.json(
            { error: "DNS is correct, but the verified status could not be saved." },
            { status: 503 },
          );
        }

        return Response.json({ verified: true, purpose: registration.purpose });
      },
    },
  },
});
