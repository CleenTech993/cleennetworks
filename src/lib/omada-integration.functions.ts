import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto.server";
import { requireSupabaseAal2 } from "@/lib/require-aal2";
import {
  assertSupportedOmadaVersion,
  testOmadaControllerLogin,
} from "@/lib/omada-controller.server";

async function tenantAdminId(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "tenant_admin")
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error || !data?.tenant_id) {
    throw new Error("Only tenant admins can manage Omada integrations.");
  }
  return data.tenant_id;
}

async function requireOmadaRouter(routerId: string, tenantId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("routers")
    .select("id")
    .eq("id", routerId)
    .eq("tenant_id", tenantId)
    .eq("vendor", "tp_link_omada")
    .maybeSingle();
  if (error || !data) throw new Error("The selected Omada device was not found.");
}

const RouterIdSchema = z.object({ routerId: z.string().uuid() });

const SaveSchema = z.object({
  routerId: z.string().uuid(),
  controllerHost: z.string().trim().min(1).max(253),
  controllerPort: z.union([z.literal(433), z.literal(443), z.literal(8043)]),
  controllerId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/),
  controllerVersion: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+$/),
  siteName: z.string().trim().min(1).max(128),
  operatorUsername: z.string().trim().min(1).max(128),
  operatorPassword: z.string().max(500).optional(),
});

type IntegrationInput = z.infer<typeof SaveSchema>;

async function readIntegration(routerId: string) {
  const { data, error } = await supabaseAdmin
    .from("omada_integrations")
    .select(
      "router_id,controller_host,controller_port,controller_id,controller_version,site_name,operator_username,operator_password_ciphertext,enabled",
    )
    .eq("router_id", routerId)
    .maybeSingle();
  if (error) {
    console.error("Could not load Omada integration", error.message);
    throw new Error("Could not load the saved Omada configuration.");
  }
  return data;
}

export const getOmadaIntegrationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof RouterIdSchema>) => RouterIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantAdminId(context.userId);
    await requireOmadaRouter(data.routerId, tenantId);
    const integration = await readIntegration(data.routerId);
    if (!integration) return { configured: false as const };
    return {
      configured: true as const,
      controllerHost: integration.controller_host,
      controllerPort: integration.controller_port,
      controllerId: integration.controller_id,
      controllerVersion: integration.controller_version,
      siteName: integration.site_name,
      operatorUsername: integration.operator_username,
      enabled: integration.enabled,
    };
  });

export const saveOmadaIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof SaveSchema>) => SaveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantAdminId(context.userId);
    await requireOmadaRouter(data.routerId, tenantId);
    const existing = await readIntegration(data.routerId);
    const password = data.operatorPassword || undefined;
    if (!existing && !password) throw new Error("Enter the hotspot operator password.");

    const ciphertext =
      password !== undefined
        ? await encryptSecret(`omada:${data.routerId}:operator_password`, password)
        : existing!.operator_password_ciphertext;
    const { error } = await supabaseAdmin.from("omada_integrations").upsert(
      {
        router_id: data.routerId,
        tenant_id: tenantId,
        controller_host: data.controllerHost,
        controller_port: data.controllerPort,
        controller_id: data.controllerId,
        controller_version: data.controllerVersion,
        site_name: data.siteName,
        operator_username: data.operatorUsername,
        operator_password_ciphertext: ciphertext,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "router_id" },
    );
    if (error) {
      console.error("Could not save Omada integration", error.message);
      throw new Error("Could not save the Omada configuration.");
    }
    return { configured: true as const };
  });

export const testOmadaIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAal2])
  .validator((input: z.input<typeof RouterIdSchema>) => RouterIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantAdminId(context.userId);
    await requireOmadaRouter(data.routerId, tenantId);
    const integration = await readIntegration(data.routerId);
    if (!integration) throw new Error("Save the Omada configuration before testing it.");

    assertSupportedOmadaVersion(integration.controller_version);
    const password = await decryptSecret(
      `omada:${data.routerId}:operator_password`,
      integration.operator_password_ciphertext,
    );
    await testOmadaControllerLogin(
      {
        host: integration.controller_host,
        port: integration.controller_port,
        controllerId: integration.controller_id,
      },
      { username: integration.operator_username, password },
    );
    return { connected: true as const };
  });
