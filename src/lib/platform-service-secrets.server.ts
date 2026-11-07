import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto.server";

export const PLATFORM_SERVICE_SECRET_NAMES = [
  "APP_BASE_URL",
  "PLATFORM_MPESA_ENV",
  "PLATFORM_MPESA_CONSUMER_KEY",
  "PLATFORM_MPESA_CONSUMER_SECRET",
  "PLATFORM_MPESA_MERCHANT_TYPE",
  "PLATFORM_MPESA_BUSINESS_SHORTCODE",
  "PLATFORM_MPESA_PASSKEY",
] as const;
export type PlatformServiceSecretName = (typeof PLATFORM_SERVICE_SECRET_NAMES)[number];
export type PlatformServiceSecrets = Partial<Record<PlatformServiceSecretName, string>>;

function secretContext(name: PlatformServiceSecretName): string {
  return `platform:${name}`;
}

export async function loadPlatformServiceSecrets(): Promise<PlatformServiceSecrets> {
  const { data, error } = await supabaseAdmin
    .from("platform_service_secrets")
    .select("name,ciphertext");
  if (error) {
    console.error("Could not load platform service credentials", error.message);
    throw new Error("Could not load saved platform credentials.");
  }

  const secrets: PlatformServiceSecrets = {};
  for (const row of data ?? []) {
    const name = row.name as PlatformServiceSecretName;
    if (!PLATFORM_SERVICE_SECRET_NAMES.includes(name)) continue;
    try {
      secrets[name] = await decryptSecret(secretContext(name), row.ciphertext);
    } catch (error) {
      console.error(`Could not decrypt platform credential ${name}`, error);
      throw new Error("Saved platform credentials need to be entered again.");
    }
  }
  return secrets;
}

export async function savePlatformServiceSecret(
  name: PlatformServiceSecretName,
  value: string,
  userId: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from("platform_service_secrets").upsert(
    {
      name,
      ciphertext: await encryptSecret(secretContext(name), value),
      last4: name.endsWith("KEY") || name.endsWith("SECRET") ? value.slice(-4) : null,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "name" },
  );
  if (error) {
    console.error(`Could not save platform credential ${name}`, error.message);
    throw new Error("Could not save the platform credential.");
  }
}
