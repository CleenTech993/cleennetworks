import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import {
  hashRouterSupportPassword,
  newRouterSupportPassword,
  ROUTER_SUPPORT_SESSION_MS,
} from "@/lib/router-support.server";

async function tenantAdminId(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "tenant_admin")
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error || !data?.tenant_id) throw new Error("Only tenant admins can create support sessions.");
  return data.tenant_id;
}

export const createRouterSupportSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input: { routerId: string }) => z.object({ routerId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantAdminId(context.userId);
    const { data: router, error: routerError } = await supabaseAdmin
      .from("routers")
      .select("id")
      .eq("id", data.routerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (routerError || !router) throw new Error("Router not found.");

    const now = new Date();
    const { error: revokeError } = await supabaseAdmin
      .from("router_support_sessions")
      .update({ revoked_at: now.toISOString() })
      .eq("router_id", router.id)
      .eq("tenant_id", tenantId)
      .is("revoked_at", null);
    if (revokeError) {
      console.error("Could not replace the previous router support session", revokeError);
      throw new Error("Could not create the support session.");
    }

    const password = newRouterSupportPassword();
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("router_support_sessions")
      .insert({
        tenant_id: tenantId,
        router_id: router.id,
        created_by: context.userId,
        password_hash: await hashRouterSupportPassword(password),
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + ROUTER_SUPPORT_SESSION_MS).toISOString(),
      })
      .select("id,expires_at")
      .single();
    if (sessionError || !session) {
      console.error("Could not create router support session", sessionError);
      throw new Error("Could not create the support session.");
    }
    return { sessionId: session.id, password, expiresAt: session.expires_at };
  });

export const revokeRouterSupportSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .inputValidator((input: { sessionId: string }) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantAdminId(context.userId);
    const { data: revoked, error } = await supabaseAdmin
      .from("router_support_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.sessionId)
      .eq("tenant_id", tenantId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (error || !revoked) throw new Error("The support session is already closed or unavailable.");
  });