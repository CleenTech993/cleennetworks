import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto.server";

export const TENANT_SERVICE_SECRET_NAMES = [
  "MPESA_ENV",
  "MPESA_MERCHANT_TYPE",
  "MPESA_BUSINESS_SHORTCODE",
  "MPESA_SHORTCODE",
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_PASSKEY",
  "AT_USERNAME",
  "AT_API_KEY",
  "AT_SENDER_ID",
] as const;
export type TenantServiceSecretName = (typeof TENANT_SERVICE_SECRET_NAMES)[number];

export type TenantServiceSecrets = Partial<Record<TenantServiceSecretName, string>>;

function secretContext(tenantId: string, name: TenantServiceSecretName): string {
  return `tenant:${tenantId}:${name}`;
}

export async function loadTenantServiceSecrets(tenantId: string): Promise<TenantServiceSecrets> {
  const { data, error } = await supabaseAdmin
    .from("tenant_service_secrets")
    .select("name,ciphertext")
    .eq("tenant_id", tenantId);
  if (error) {
    console.error("Could not load tenant service credentials", error.message);
    throw new Error("Could not load saved credentials.");
  }

  const secrets: TenantServiceSecrets = {};
  for (const row of data ?? []) {
    const name = row.name as TenantServiceSecretName;
    if (!TENANT_SERVICE_SECRET_NAMES.includes(name)) continue;
    try {
      secrets[name] = await decryptSecret(secretContext(tenantId, name), row.ciphertext);
    } catch (error) {
      console.error(`Could not decrypt ${name} for tenant ${tenantId}`, error);
      throw new Error("Saved credentials need to be entered again.");
    }
  }
  return secrets;
}

export async function saveTenantServiceSecret(
  tenantId: string,
  name: TenantServiceSecretName,
  value: string,
  userId: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from("tenant_service_secrets").upsert(
    {
      tenant_id: tenantId,
      name,
      ciphertext: await encryptSecret(secretContext(tenantId, name), value),
      last4: value.slice(-4),
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "tenant_id,name" },
  );
  if (error) {
    console.error(`Could not save ${name} for tenant ${tenantId}`, error.message);
    throw new Error("Could not save the credential.");
  }
}

export async function deleteTenantServiceSecrets(tenantId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("tenant_service_secrets")
    .delete()
    .eq("tenant_id", tenantId);
  if (error) {
    console.error(`Could not remove credentials for tenant ${tenantId}`, error.message);
    throw new Error("Could not remove the saved credentials.");
  }
}
