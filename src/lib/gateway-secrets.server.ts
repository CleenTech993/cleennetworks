// Payment gateway secrets entered on the Super admin dashboard. Server only.
//
// Storage: public.platform_gateway_secrets, encrypted with AES-256-GCM and readable only by the service
// role (see the migration). Precedence: a value saved on the dashboard wins; otherwise the INTASEND_*
// environment variable is used, so existing env-based setups keep working untouched.
//
// Key material: PLATFORM_SECRETS_KEY if set, else SUPABASE_SERVICE_ROLE_KEY (always present on the
// server). A per-secret key is derived with HKDF and the secret's name is bound in as GCM associated
// data, so a stored value cannot be copied onto another row. If the key material changes (for example
// the service key is rotated) stored values stop decrypting: they are reported as "needs re-entering"
// and the environment fallback keeps working, rather than the app failing.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const GATEWAY_SECRET_NAMES = ["INTASEND_SECRET_KEY", "INTASEND_WEBHOOK_CHALLENGE"] as const;
export type GatewaySecretName = (typeof GATEWAY_SECRET_NAMES)[number];

const SALT = new TextEncoder().encode("netgrid/platform-secrets/v1");
const CACHE_TTL_MS = 15_000;

const b64u = {
  enc(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(s: string): Uint8Array {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

async function deriveKey(name: string, ikm: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(ikm), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: new TextEncoder().encode(name) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function keyMaterial(): string {
  const m = process.env["PLATFORM_SECRETS_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!m) throw new Error("No encryption key material available on the server.");
  return m;
}

/** "v1.<iv>.<ciphertext+tag>", all base64url. `ikm` is only passed by tests. */
export async function encryptSecret(name: string, plaintext: string, ikm = keyMaterial()): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(name) },
    await deriveKey(name, ikm),
    new TextEncoder().encode(plaintext),
  );
  return `v1.${b64u.enc(iv)}.${b64u.enc(new Uint8Array(ct))}`;
}

export async function decryptSecret(name: string, stored: string, ikm = keyMaterial()): Promise<string> {
  const [v, iv, ct] = stored.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unrecognised secret format.");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64u.dec(iv) as BufferSource, additionalData: new TextEncoder().encode(name) },
    await deriveKey(name, ikm),
    b64u.dec(ct) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

interface Loaded {
  values: Map<GatewaySecretName, string>;
  meta: Map<GatewaySecretName, { last4: string | null; updatedAt: string | null; unreadable: boolean }>;
  at: number;
}
let cache: Loaded | null = null;

/** Reads and decrypts the stored secrets (cached ~15s per server instance). Never throws. */
export async function loadGatewaySecrets(opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return;
  const next: Loaded = { values: new Map(), meta: new Map(), at: Date.now() };
  try {
    const { data, error } = await supabaseAdmin
      .from("platform_gateway_secrets")
      .select("name,ciphertext,last4,updated_at");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const name = row.name as GatewaySecretName;
      if (!GATEWAY_SECRET_NAMES.includes(name)) continue;
      try {
        next.values.set(name, await decryptSecret(name, row.ciphertext as string));
        next.meta.set(name, { last4: (row.last4 as string | null) ?? null, updatedAt: row.updated_at as string, unreadable: false });
      } catch {
        // Wrong/rotated key or corrupt value: fall back to the environment and flag it for re-entry.
        console.error(`gateway secret ${name} could not be decrypted; falling back to the environment`);
        next.meta.set(name, { last4: null, updatedAt: row.updated_at as string, unreadable: true });
      }
    }
  } catch (e) {
    console.error("loadGatewaySecrets failed; using environment variables only", e instanceof Error ? e.message : e);
  }
  cache = next;
}

/** Sync accessor: dashboard value if loaded, else the environment variable. Call loadGatewaySecrets() first. */
export function gatewaySecret(name: GatewaySecretName): string | undefined {
  return cache?.values.get(name) || process.env[name] || undefined;
}

export type SecretSource = "dashboard" | "environment" | null;
export interface SecretStatus {
  set: boolean;
  source: SecretSource;
  last4: string | null;
  updatedAt: string | null;
  /** A dashboard value exists but cannot be decrypted (key material changed): it must be entered again. */
  needsReentry: boolean;
}

export function gatewaySecretStatus(name: GatewaySecretName): SecretStatus {
  const dash = cache?.values.get(name);
  const meta = cache?.meta.get(name);
  const env = process.env[name] || undefined;
  const value = dash || env;
  return {
    set: !!value,
    source: dash ? "dashboard" : env ? "environment" : null,
    last4: value ? value.slice(-4) : null,
    updatedAt: dash ? (meta?.updatedAt ?? null) : null,
    needsReentry: !!meta?.unreadable,
  };
}

export async function saveGatewaySecret(name: GatewaySecretName, value: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("platform_gateway_secrets").upsert(
    {
      name,
      ciphertext: await encryptSecret(name, value),
      last4: value.slice(-4),
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "name" },
  );
  if (error) throw new Error("Could not save the credential.");
  await loadGatewaySecrets({ force: true });
}

export async function deleteGatewaySecret(name: GatewaySecretName): Promise<void> {
  const { error } = await supabaseAdmin.from("platform_gateway_secrets").delete().eq("name", name);
  if (error) throw new Error("Could not remove the credential.");
  await loadGatewaySecrets({ force: true });
}

/** Test helper. */
export function resetGatewaySecretCache(): void {
  cache = null;
}
