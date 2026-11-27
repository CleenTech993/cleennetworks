import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { createTenantApiKey, TENANT_API_SCOPES, type TenantApiScope } from "@/lib/api-key";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(TENANT_API_SCOPES as [TenantApiScope, ...TenantApiScope[]]))
    .min(1)
    .max(4)
    .refine((values) => new Set(values).size === values.length, {
      message: "Scopes must not contain duplicates.",
    }),
  expiresInDays: z.number().int().min(1).max(365).nullable(),
});

async function tenantAdminClaims(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token)
    return { response: Response.json({ error: "Sign in to manage API keys." }, { status: 401 }) };
  const { data, error } = await supabaseAdmin.auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims?.sub) {
    return {
      response: Response.json(
        { error: "Your session is invalid. Sign in again." },
        { status: 401 },
      ),
    };
  }
  if (claims.aal !== "aal2") {
    return {
      response: Response.json({ error: "Complete two-step verification first." }, { status: 403 }),
    };
  }
  const { data: profiles, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id")
    .eq("id", claims.sub)
    .maybeSingle();
  if (profileError || !profiles?.tenant_id) {
    return {
      response: Response.json({ error: "No tenant account is available." }, { status: 403 }),
    };
  }
  const { data: roles, error: rolesError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", claims.sub)
    .eq("tenant_id", profiles.tenant_id);
  if (
    rolesError ||
    !roles?.some((role) => role.role === "tenant_admin" || role.role === "super_admin")
  ) {
    return {
      response: Response.json(
        { error: "Only tenant admins can manage API keys." },
        { status: 403 },
      ),
    };
  }
  return { tenantId: profiles.tenant_id, userId: claims.sub };
}

export const Route = createFileRoute("/api/tenant/api-keys")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = await tenantAdminClaims(request);
        if ("response" in context) return context.response;
        const { data, error } = await supabaseAdmin
          .from("tenant_api_keys")
          .select("id,name,key_prefix,scopes,expires_at,last_used_at,revoked_at,created_at")
          .eq("tenant_id", context.tenantId)
          .order("created_at", { ascending: false });
        if (error) {
          console.error("Could not list tenant API keys", error);
          return Response.json({ error: "Could not load API keys." }, { status: 503 });
        }
        return Response.json({ keys: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        const context = await tenantAdminClaims(request);
        if ("response" in context) return context.response;
        if (
          !rateLimit(`tenant-api-key-create:${context.userId}:${clientIp(request)}`, 10, 60_000)
        ) {
          return tooManyRequests();
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400 });
        }
        const parsed = CreateSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid API key." },
            { status: 400 },
          );
        }
        const generated = createTenantApiKey();
        const expiresAt = parsed.data.expiresInDays
          ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString()
          : null;
        const { data, error } = await supabaseAdmin
          .from("tenant_api_keys")
          .insert({
            tenant_id: context.tenantId,
            name: parsed.data.name,
            key_prefix: generated.prefix,
            key_hash: generated.hash,
            scopes: parsed.data.scopes,
            expires_at: expiresAt,
            created_by: context.userId,
          })
          .select("id,name,key_prefix,scopes,expires_at,created_at")
          .single();
        if (error) {
          console.error("Could not create tenant API key", error);
          return Response.json({ error: "Could not create API key." }, { status: 503 });
        }
        return Response.json(
          { key: generated.key, record: data },
          { status: 201, headers: { "Cache-Control": "no-store" } },
        );
      },
      DELETE: async ({ request }) => {
        const context = await tenantAdminClaims(request);
        if ("response" in context) return context.response;
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400 });
        }
        const parsed = z.object({ keyId: z.string().uuid() }).safeParse(body);
        if (!parsed.success)
          return Response.json({ error: "Invalid API key ID." }, { status: 400 });
        const { data, error } = await supabaseAdmin
          .from("tenant_api_keys")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", parsed.data.keyId)
          .eq("tenant_id", context.tenantId)
          .is("revoked_at", null)
          .select("id")
          .maybeSingle();
        if (error) {
          console.error("Could not revoke tenant API key", error);
          return Response.json({ error: "Could not revoke API key." }, { status: 503 });
        }
        if (!data) return Response.json({ error: "API key not found." }, { status: 404 });
        return Response.json({ revoked: true });
      },
    },
  },
});
